"use client";

import { useState } from "react";

/** Copia un texto al portapapeles y lo confirma en el mismo botón. */
export function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      className="button secondary small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // Sin permiso de portapapeles el texto sigue a la vista para copiarlo a mano.
        }
      }}
      type="button"
    >
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
}
