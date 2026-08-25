import type { ActivityEvent } from "@/lib/audit";

/**
 * La actividad como organismo.
 *
 * Esto no es una herramienta de diagnóstico --para eso está la tabla de abajo, que
 * filtra, pagina y muestra el detalle exacto--. Es la pieza que responde de un vistazo
 * "¿esto está vivo, y quién lo mueve?".
 *
 * Tres decisiones de dibujo que hacen la diferencia entre un diagrama y algo que
 * parece respirar:
 *
 * 1. **Nada está quieto.** Cada nodo late con su propio período y su propia fase. Un
 *    conjunto de cosas que se mueven al unísono se lee como una animación; cuando cada
 *    una va a su ritmo, se lee como un montón de cosas vivas.
 * 2. **Los pulsos son eventos reales.** Cada partícula que viaja por una línea es una
 *    llamada que ocurrió, y viajan más seguido donde hubo más actividad. Lo que se ve
 *    moverse es el trabajo, no un adorno.
 * 3. **Lo reciente brilla y lo viejo se apaga.** Sin eso, media hora de calma se ve
 *    igual que media hora de trabajo intenso.
 *
 * Se dibuja con SVG y animaciones declarativas: sin lienzo, sin bucle de animación, sin
 * dependencias. El navegador anima esto en el compositor y no cuesta nada.
 */

const ANCHO = 1040;
const ALTO = 430;
const CENTRO = { x: ANCHO / 2, y: ALTO / 2 };

// Cuántos eventos alimentan el dibujo. Más que esto no agrega lectura: satura.
const EVENTOS_VISIBLES = 40;
const MAX_ACTORES = 6;
const MAX_ENTIDADES = 7;

type Especie = "persona" | "agente" | "entidad";

type Nodo = {
  clave: string;
  etiqueta: string;
  detalle: string;
  especie: Especie;
  actividad: number;
  fallos: number;
  /** Milisegundos desde el evento más reciente de este nodo. */
  frescura: number;
  x: number;
  y: number;
  lado: "izquierda" | "derecha";
};

type Vinculo = { clave: string; desde: Nodo; hacia: Nodo; actividad: number; fallos: number };

function recortar(texto: string, maximo: number) {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > maximo ? `${limpio.slice(0, maximo - 1)}…` : limpio;
}

/**
 * Reparte los nodos sobre un arco, no sobre una línea recta.
 *
 * En una columna vertical las etiquetas de nodos vecinos se pisan apenas hay más de
 * cuatro: cada nodo ocupa su círculo más dos renglones de texto. Sobre un arco, cada
 * uno se corre además en horizontal, y esa diferencia alcanza para que los textos no
 * se toquen.
 */
function posicionEnArco(indice: number, total: number, lado: "izquierda" | "derecha") {
  const abertura = Math.min(2.5, 0.55 + total * 0.28);
  const paso = total <= 1 ? 0 : abertura / (total - 1);
  const angulo = -abertura / 2 + paso * indice;
  const radioX = 368;
  const radioY = 158;
  const direccion = lado === "izquierda" ? -1 : 1;
  return {
    x: CENTRO.x + direccion * radioX * Math.cos(angulo),
    y: CENTRO.y + radioY * Math.sin(angulo),
  };
}

function construir(eventos: ActivityEvent[], etiquetasDeEntidad: Record<string, string>) {
  const recientes = eventos.slice(0, EVENTOS_VISIBLES);
  const ahora = Date.now();
  const semillas = new Map<string, Omit<Nodo, "x" | "y" | "lado">>();
  const vinculos = new Map<string, { desde: string; hacia: string; actividad: number; fallos: number }>();

  const sumar = (
    clave: string,
    etiqueta: string,
    detalle: string,
    especie: Especie,
    fallo: boolean,
    edad: number,
  ) => {
    const previo = semillas.get(clave);
    if (previo) {
      previo.actividad += 1;
      previo.fallos += fallo ? 1 : 0;
      previo.frescura = Math.min(previo.frescura, edad);
      return;
    }
    semillas.set(clave, {
      clave,
      etiqueta: recortar(etiqueta, 22),
      detalle,
      especie,
      actividad: 1,
      fallos: fallo ? 1 : 0,
      frescura: edad,
    });
  };

  for (const evento of recientes) {
    const fallo = evento.status === "failed";
    const edad = Math.max(0, ahora - new Date(evento.created_at).getTime());

    const actorClave = evento.source === "agent"
      ? `agente:${evento.agent_id ?? evento.agent_name ?? "?"}`
      : `persona:${evento.actor_id ?? evento.actor_name ?? "?"}`;
    sumar(
      actorClave,
      evento.source === "agent" ? evento.agent_name ?? "Agente" : evento.actor_name ?? "Persona",
      evento.source === "agent"
        ? `a cargo de ${evento.responsible_name ?? "nadie"}`
        : evento.actor_email ?? "persona",
      evento.source === "agent" ? "agente" : "persona",
      fallo,
      edad,
    );

    if (!evento.entity_key) continue;
    const entidadClave = `entidad:${evento.entity_key}`;
    // El detalle se completa después con el total de operaciones: cuántas veces se tocó
    // dice más que cuál fue la última, y no expone el nombre interno de una herramienta.
    sumar(
      entidadClave,
      etiquetasDeEntidad[evento.entity_key] ?? evento.entity_key,
      "",
      "entidad",
      fallo,
      edad,
    );

    for (const [desde, hacia] of [[actorClave, "nucleo"], ["nucleo", entidadClave]] as const) {
      const clave = `${desde}->${hacia}`;
      const previo = vinculos.get(clave);
      if (previo) {
        previo.actividad += 1;
        previo.fallos += fallo ? 1 : 0;
      } else {
        vinculos.set(clave, { desde, hacia, actividad: 1, fallos: fallo ? 1 : 0 });
      }
    }
  }

  const porActividad = (a: { actividad: number }, b: { actividad: number }) => b.actividad - a.actividad;
  const actores = [...semillas.values()].filter((n) => n.especie !== "entidad").sort(porActividad).slice(0, MAX_ACTORES);
  const entidades = [...semillas.values()].filter((n) => n.especie === "entidad").sort(porActividad).slice(0, MAX_ENTIDADES);

  for (const nodo of [...actores, ...entidades]) {
    if (nodo.especie !== "entidad") continue;
    nodo.detalle = nodo.actividad === 1 ? "1 operación" : `${nodo.actividad} operaciones`;
  }

  const nodos: Nodo[] = [];
  actores.forEach((nodo, indice) => {
    nodos.push({ ...nodo, ...posicionEnArco(indice, actores.length, "izquierda"), lado: "izquierda" });
  });
  entidades.forEach((nodo, indice) => {
    nodos.push({ ...nodo, ...posicionEnArco(indice, entidades.length, "derecha"), lado: "derecha" });
  });

  const nucleo: Nodo = {
    clave: "nucleo",
    etiqueta: "",
    detalle: "",
    especie: "entidad",
    actividad: recientes.length,
    fallos: recientes.filter((e) => e.status === "failed").length,
    frescura: recientes.length ? Math.max(0, ahora - new Date(recientes[0].created_at).getTime()) : Infinity,
    ...CENTRO,
    lado: "derecha",
  };

  const porClave = new Map<string, Nodo>([...nodos.map((n) => [n.clave, n] as const), ["nucleo", nucleo]]);
  const arcos: Vinculo[] = [...vinculos.values()]
    .map((v) => ({
      clave: `${v.desde}->${v.hacia}`,
      desde: porClave.get(v.desde),
      hacia: porClave.get(v.hacia),
      actividad: v.actividad,
      fallos: v.fallos,
    }))
    .filter((v): v is Vinculo => Boolean(v.desde && v.hacia));

  return { nodos, nucleo, arcos, total: recientes.length };
}

/** Una curva suave: las líneas rectas se leen como cables, las curvas como tejido. */
function curva(desde: Nodo, hacia: Nodo) {
  const dx = hacia.x - desde.x;
  const control = Math.abs(dx) * 0.42;
  return `M ${desde.x} ${desde.y} C ${desde.x + control} ${desde.y}, ${hacia.x - control} ${hacia.y}, ${hacia.x} ${hacia.y}`;
}

function radio(nodo: Nodo) {
  return Math.min(30, 15 + Math.sqrt(nodo.actividad) * 3.2);
}

/**
 * El brillo es relativo al conjunto que se está mirando, no a un reloj absoluto.
 *
 * Con una escala fija --"lo de hace más de una hora se apaga"-- una aplicación que
 * trabajó ayer y hoy no se ve igual: se ve muerta. Todos los nodos caen al mínimo y el
 * dibujo pierde la única señal que transmite movimiento.
 *
 * Comparando contra el propio conjunto, el más reciente siempre brilla y el resto se
 * ordena detrás. La lectura pasa a ser "qué se movió último", que es la pregunta real,
 * y funciona igual con datos de hace cinco minutos o de la semana pasada.
 */
function escalaDeBrillo(nodos: Array<{ frescura: number }>) {
  const finitas = nodos.map((n) => n.frescura).filter((f) => Number.isFinite(f));
  if (!finitas.length) return () => 0.8;
  // El extremo es el propio conjunto: forzar el mínimo a cero dejaría el nodo más
  // reciente a media luz salvo que su evento fuera de este instante.
  const masNuevo = Math.min(...finitas);
  const masViejo = Math.max(...finitas);
  const rango = Math.max(1, masViejo - masNuevo);
  return (frescura: number) => {
    if (!Number.isFinite(frescura)) return 0.4;
    return 1 - 0.55 * ((frescura - masNuevo) / rango);
  };
}

export function ActivityOrganism({
  events,
  entityLabels,
  total,
}: {
  events: ActivityEvent[];
  entityLabels: Record<string, string>;
  total: number;
}) {
  const { nodos, nucleo, arcos, total: dibujados } = construir(events, entityLabels);
  const brillo = escalaDeBrillo(nodos);
  const agentes = nodos.filter((n) => n.especie === "agente").length;
  const personas = nodos.filter((n) => n.especie === "persona").length;
  const fallos = nucleo.fallos;

  if (!dibujados) {
    return (
      <section className="organism-card">
        <div className="organism-head">
          <div>
            <p className="eyebrow">Sistema en movimiento</p>
            <h2>Todavía en silencio</h2>
          </div>
        </div>
        <p className="subtitle organism-empty">
          Cuando alguien cargue algo o un agente consulte, va a aparecer acá.
        </p>
      </section>
    );
  }

  return (
    <section className="organism-card">
      <div className="organism-head">
        <div>
          <p className="eyebrow">Sistema en movimiento</p>
          <h2>Actividad reciente</h2>
          <p className="subtitle">
            Cada partícula es una llamada real. Se dibujan las últimas {dibujados} de{" "}
            {total.toLocaleString("es-AR")}.
          </p>
        </div>
        <div className="organism-stats">
          <span><strong>{personas}</strong> personas</span>
          <span><strong>{agentes}</strong> agentes</span>
          <span><strong>{nodos.filter((n) => n.especie === "entidad").length}</strong> datos</span>
          {fallos > 0 && <span className="organism-failures"><strong>{fallos}</strong> fallos</span>}
        </div>
      </div>

      <div className="organism-scroll">
      <svg
        aria-label={`Diagrama de actividad: ${personas} personas y ${agentes} agentes operando sobre ${nodos.filter((n) => n.especie === "entidad").length} conjuntos de datos.`}
        className="organism-canvas"
        role="img"
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
      >
        <defs>
          <radialGradient id="halo-nucleo">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.42" />
            <stop offset="70%" stopColor="var(--primary)" stopOpacity="0.06" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
          {arcos.map((arco) => (
            <path d={curva(arco.desde, arco.hacia)} id={`ruta-${arco.clave}`} key={`def-${arco.clave}`} />
          ))}
        </defs>

        <circle className="organism-halo" cx={CENTRO.x} cy={CENTRO.y} fill="url(#halo-nucleo)" r={190} />

        {arcos.map((arco) => (
          <use
            className={`organism-link ${arco.fallos ? "failed" : ""}`}
            href={`#ruta-${arco.clave}`}
            key={`arco-${arco.clave}`}
            style={{ opacity: 0.16 + Math.min(0.34, arco.actividad * 0.05) }}
          />
        ))}

        {/* Las partículas: una por cada tramo, con más frecuencia donde hubo más trabajo.
            `animateMotion` las mueve sin JavaScript y sin repintar el resto del dibujo. */}
        {arcos.flatMap((arco) => {
          const cantidad = Math.min(3, 1 + Math.floor(arco.actividad / 4));
          const duracion = Math.max(1.8, 4.6 - arco.actividad * 0.22);
          return Array.from({ length: cantidad }, (_, i) => (
            <circle
              className={`organism-pulse ${arco.fallos ? "failed" : ""}`}
              key={`pulso-${arco.clave}-${i}`}
              r={arco.fallos ? 4.2 : 3.4}
            >
              <animateMotion
                begin={`${(i * duracion) / cantidad}s`}
                dur={`${duracion}s`}
                repeatCount="indefinite"
              >
                <mpath href={`#ruta-${arco.clave}`} />
              </animateMotion>
            </circle>
          ));
        })}

        <g className="organism-core">
          <circle cx={CENTRO.x} cy={CENTRO.y} r={46} />
          <circle className="organism-core-ring" cx={CENTRO.x} cy={CENTRO.y} r={46} />
          <circle className="organism-core-dot" cx={CENTRO.x} cy={CENTRO.y} r={9} />
        </g>

        {nodos.map((nodo, indice) => {
          const r = radio(nodo);
          const haciaFuera = nodo.lado === "izquierda" ? -1 : 1;
          return (
            <g
              className={`organism-node ${nodo.especie} ${nodo.fallos ? "failed" : ""}`}
              key={nodo.clave}
              style={{
                // Cada uno con su propio ritmo: al unísono se ve mecánico.
                animationDelay: `${(indice % 7) * 0.42}s`,
                animationDuration: `${3.4 + (indice % 5) * 0.55}s`,
                opacity: brillo(nodo.frescura),
                transformOrigin: `${nodo.x}px ${nodo.y}px`,
              }}
            >
              <circle className="organism-node-glow" cx={nodo.x} cy={nodo.y} r={r + 9} />
              <circle className="organism-node-body" cx={nodo.x} cy={nodo.y} r={r} />
              <circle className="organism-node-core" cx={nodo.x} cy={nodo.y} r={r * 0.32} />
              <text
                className="organism-node-label"
                textAnchor={nodo.lado === "izquierda" ? "end" : "start"}
                x={nodo.x + haciaFuera * (r + 13)}
                y={nodo.y - 2}
              >
                {nodo.etiqueta}
              </text>
              <text
                className="organism-node-detail"
                textAnchor={nodo.lado === "izquierda" ? "end" : "start"}
                x={nodo.x + haciaFuera * (r + 13)}
                y={nodo.y + 14}
              >
                {recortar(nodo.detalle, 26)}
              </text>
            </g>
          );
        })}
      </svg>
      </div>

      <div className="organism-legend">
        <span><i className="dot persona" />Persona</span>
        <span><i className="dot agente" />Agente</span>
        <span><i className="dot entidad" />Datos</span>
        {fallos > 0 && <span><i className="dot fallo" />Rechazado</span>}
        <span className="organism-legend-note">Más brillo, más reciente.</span>
      </div>
    </section>
  );
}
