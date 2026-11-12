"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { subirArchivoAIteracionAction } from "@/app/procesos/actions";

/**
 * Subir las láminas de una iteración: se eligen todas juntas y viajan de a una, en orden de
 * nombre (slide-01, slide-02…), para no chocar con el límite de tamaño de un pedido.
 */
export function SubirLaminas({ iteracion }: { iteracion: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function subir(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const entrada = evento.currentTarget.elements.namedItem("archivos") as HTMLInputElement | null;
    const archivos = [...(entrada?.files ?? [])].sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }));
    if (!archivos.length) return;
    setError(null);
    iniciar(async () => {
      for (const [indice, archivo] of archivos.entries()) {
        setEstado(`Subiendo ${indice + 1} de ${archivos.length}: ${archivo.name}`);
        const datos = new FormData();
        datos.set("iteracion", iteracion);
        datos.set("archivo", archivo);
        const respuesta = await subirArchivoAIteracionAction(datos);
        if (!respuesta.ok) {
          setError(`${archivo.name}: ${respuesta.error}`);
          break;
        }
      }
      setEstado(null);
      if (entrada) entrada.value = "";
      router.refresh();
    });
  }

  return (
    <form className="upload-slides" onSubmit={subir}>
      <input accept="image/jpeg,image/png,image/webp" aria-label="Láminas del resultado" className="control" multiple name="archivos" type="file" />
      <button className="button secondary" disabled={pendiente} type="submit">{pendiente ? "Subiendo…" : "Subir imágenes"}</button>
      {estado && <span className="table-secondary">{estado}</span>}
      {error && <span className="danger-text">{error}</span>}
    </form>
  );
}
