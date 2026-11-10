/**
 * Lo que dejó una etapa, mostrado para alguien que tiene que decidir sin abrir carpetas.
 *
 * Una salida es JSON libre: la definición del proceso dice qué claves hay, no su forma.
 * Esto la recorre y muestra cada cosa como lo que es: una imagen se ve, un enlace se
 * puede abrir, un texto se lee. Nunca ejecuta ni interpreta HTML: todo es texto o un
 * atributo `src`/`href` con protocolo web.
 */

const IMAGEN = /\.(png|jpe?g|webp|gif|avif)$/i;
const CLAVES_DE_IMAGEN = new Set(["vista_previa", "imagen", "imagenes", "foto", "fotos", "miniatura"]);
const CLAVES_DE_TITULO = ["titulo", "nombre", "tema"];
const CLAVES_DE_TEXTO = ["descripcion", "resumen", "angulo", "detalle"];

function comoUrl(valor: unknown) {
  if (typeof valor !== "string") return null;
  try {
    const url = new URL(valor.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * La dirección que muestra la imagen en sí. Un enlace compartido de Dropbox abre una
 * página de vista previa; con `raw=1` devuelve el archivo, que es lo que un `img` necesita.
 */
function fuenteDeImagen(url: URL) {
  if (url.hostname.endsWith("dropbox.com")) {
    const directa = new URL(url);
    directa.searchParams.delete("dl");
    directa.searchParams.set("raw", "1");
    return directa.toString();
  }
  return url.toString();
}

function esImagen(url: URL, claveDeImagen: boolean) {
  return claveDeImagen || IMAGEN.test(url.pathname);
}

/** Las claves se escriben sin tildes; para leerlas, se les devuelven. */
const CON_TILDE: Record<string, string> = {
  conversacion: "Conversación",
  descripcion: "Descripción",
  situacion: "Situación",
  angulo: "Ángulo",
  version: "Versión",
  reproduccion: "Reproducción",
  eleccion: "Elección",
  que_falto: "Qué faltó",
  salio_igual: "Salió igual",
};

function etiqueta(clave: string) {
  if (CON_TILDE[clave]) return CON_TILDE[clave];
  const texto = clave.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function Valor({ valor, clave }: { valor: unknown; clave?: string }) {
  const deImagen = clave ? CLAVES_DE_IMAGEN.has(clave) : false;
  if (valor === null || valor === undefined || valor === "") return <span className="table-secondary">—</span>;

  const url = comoUrl(valor);
  if (url) {
    if (esImagen(url, deImagen)) {
      return (
        <a className="output-image" href={url.toString()} rel="noreferrer" target="_blank">
          {/* eslint-disable-next-line @next/next/no-img-element -- imágenes de cualquier origen, sin optimizar */}
          <img alt={clave ? etiqueta(clave) : "Vista previa"} loading="lazy" src={fuenteDeImagen(url)} />
        </a>
      );
    }
    return <a className="record-link" href={url.toString()} rel="noreferrer" target="_blank">{url.hostname}{url.pathname.length > 1 ? " · abrir" : ""}</a>;
  }

  if (typeof valor === "string") return <span className="output-text">{valor}</span>;
  if (typeof valor === "number" || typeof valor === "boolean") return <span>{String(valor)}</span>;

  if (Array.isArray(valor)) {
    const todasImagenes = valor.every((item) => {
      const u = comoUrl(item);
      return u && esImagen(u, deImagen);
    });
    return (
      <div className={todasImagenes ? "output-gallery" : "output-list"}>
        {valor.map((item, indice) => <Valor clave={clave} key={indice} valor={item} />)}
      </div>
    );
  }

  if (typeof valor === "object") return <Objeto valor={valor as Record<string, unknown>} />;
  return <span>{String(valor)}</span>;
}

function Objeto({ valor }: { valor: Record<string, unknown> }) {
  const claveTitulo = CLAVES_DE_TITULO.find((clave) => typeof valor[clave] === "string");
  const clavesTexto = CLAVES_DE_TEXTO.filter((clave) => typeof valor[clave] === "string");
  const resto = Object.entries(valor).filter(([clave]) => clave !== claveTitulo && !clavesTexto.includes(clave));
  return (
    <div className="output-object">
      {claveTitulo && <div className="output-title">{String(valor[claveTitulo])}</div>}
      {clavesTexto.map((clave) => <p className="output-text" key={clave}>{String(valor[clave])}</p>)}
      {resto.length > 0 && (
        <dl className="output-fields">
          {resto.map(([clave, item]) => (
            <div key={clave}>
              <dt>{etiqueta(clave)}</dt>
              <dd><Valor clave={clave} valor={item} /></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/** Una opción para elegir: su contenido, sin repetir el número que ya lleva el botón. */
export function Opcion({ valor }: { valor: unknown }) {
  return <Valor valor={valor} />;
}

function textos(valor: unknown) {
  return Array.isArray(valor) ? valor.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

/**
 * Cómo se hizo algo: la receta de un cierre o de una iteración registrada. Los prompts
 * se muestran tal cual, que es lo que otra persona necesita para repetirlo.
 */
export function Receta({ receta }: { receta: Record<string, unknown> }) {
  const pasos = textos(receta.pasos);
  const prompts = textos(receta.prompts);
  const herramientas = textos(receta.herramientas);
  const decisiones = textos(receta.decisiones);
  const descartes = [...textos(receta.descartes), ...textos(receta.fallos)];
  return (
    <div className="recipe">
      {typeof receta.modelo === "string" && <p><span className="table-secondary">Con</span> {receta.modelo}</p>}
      {pasos.length > 0 && (
        <div>
          <div className="card-label">Pasos</div>
          <ol>{pasos.map((paso, indice) => <li key={indice}>{paso}</li>)}</ol>
        </div>
      )}
      {prompts.length > 0 && (
        <div>
          <div className="card-label">Prompts que funcionaron</div>
          {prompts.map((prompt, indice) => <blockquote className="recipe-prompt" key={indice}>{prompt}</blockquote>)}
        </div>
      )}
      {herramientas.length > 0 && (
        <p><span className="table-secondary">Herramientas:</span> {herramientas.join(", ")}</p>
      )}
      {decisiones.length > 0 && (
        <div>
          <div className="card-label">Decisiones</div>
          <ul>{decisiones.map((decision, indice) => <li key={indice}>{decision}</li>)}</ul>
        </div>
      )}
      {descartes.length > 0 && (
        <div>
          <div className="card-label">Lo que no funcionó</div>
          <ul>{descartes.map((descarte, indice) => <li key={indice}>{descarte}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** Todas las salidas de una etapa, clave por clave. */
export function Salidas({ salidas }: { salidas: Record<string, unknown> }) {
  const entradas = Object.entries(salidas);
  if (!entradas.length) return null;
  return (
    <dl className="output-fields">
      {entradas.map(([clave, valor]) => (
        <div key={clave}>
          <dt>{etiqueta(clave)}</dt>
          <dd><Valor clave={clave} valor={valor} /></dd>
        </div>
      ))}
    </dl>
  );
}
