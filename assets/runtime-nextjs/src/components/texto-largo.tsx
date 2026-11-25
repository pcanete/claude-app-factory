import { Fragment, type ReactNode } from "react";
import { leerTextoLargo, type Linea, type Parte } from "@/lib/texto-largo";

/**
 * Un texto largo (notas, descripciones) en la ficha: markdown leído a elementos de React.
 * Nunca se usa dangerouslySetInnerHTML: el texto lo escriben personas y agentes, y en la
 * ficha sólo puede verse, no ejecutarse.
 */

function partes(lista: Parte[]): ReactNode {
  return lista.map((parte, i) => {
    if (parte.tipo === "texto") return <Fragment key={i}>{parte.texto}</Fragment>;
    if (parte.tipo === "negrita") return <strong key={i}>{partes(parte.partes)}</strong>;
    return (
      <a href={parte.href} key={i} rel="noopener noreferrer nofollow" target="_blank">
        {partes(parte.partes)}
      </a>
    );
  });
}

function lineas(lista: Linea[]): ReactNode {
  return lista.map((linea, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {partes(linea)}
    </Fragment>
  ));
}

export function TextoLargo({ texto }: { texto: string }) {
  return (
    <div className="texto-largo">
      {leerTextoLargo(texto).map((bloque, i) => {
        switch (bloque.tipo) {
          case "titulo": {
            const Etiqueta = (["h3", "h4", "h5"] as const)[bloque.nivel - 1];
            return <Etiqueta key={i}>{partes(bloque.partes)}</Etiqueta>;
          }
          case "parrafo":
            return <p key={i}>{lineas(bloque.lineas)}</p>;
          case "cita":
            return <blockquote key={i}>{lineas(bloque.lineas)}</blockquote>;
          case "separador":
            return <hr key={i} />;
          case "lista": {
            const Lista = bloque.ordenada ? "ol" : "ul";
            return <Lista key={i}>{bloque.items.map((item, j) => <li key={j}>{partes(item)}</li>)}</Lista>;
          }
        }
      })}
    </div>
  );
}
