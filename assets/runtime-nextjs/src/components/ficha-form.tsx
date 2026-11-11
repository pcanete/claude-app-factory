import Link from "next/link";
import type { Ficha } from "@/platform/processes/definition";
import { guardarProcesoAction } from "@/app/procesos/actions";

/**
 * El formulario de la ficha de un proceso: el mismo para el alta y para la modificación.
 * Sin `familia` da de alta un proceso; con `familia` cambia su ficha en el lugar.
 */
export function FichaForm({ familia, nombre, ficha, cancelarHref }: {
  familia?: string;
  nombre?: string;
  ficha?: Ficha | null;
  cancelarHref: string;
}) {
  return (
    <form action={guardarProcesoAction} className="form-card">
      {familia && <input name="familia" type="hidden" value={familia} />}
      <div className="form-grid">
        <label className="field full">
          <span className="field-label">Nombre *</span>
          <input className="control" defaultValue={nombre ?? ""} maxLength={120} minLength={3} name="nombre" placeholder="Carrusel P3 Negocios" required />
        </label>
        <label className="field full">
          <span className="field-label">Qué hace, en una línea *</span>
          <input className="control" defaultValue={ficha?.resumen ?? ""} maxLength={200} name="resumen" placeholder="El negocio de un deportista contado en 9 láminas, con fotos reales." required />
          <span className="field-help">Es lo que se lee en la tarjeta del proceso.</span>
        </label>
        <label className="field">
          <span className="field-label">Qué hay que darle</span>
          <textarea className="control" defaultValue={ficha?.entrada ?? ""} maxLength={500} name="entrada" rows={2} />
        </label>
        <label className="field">
          <span className="field-label">Qué entrega</span>
          <textarea className="control" defaultValue={ficha?.entrega ?? ""} maxLength={500} name="entrega" rows={2} />
        </label>
        <label className="field full">
          <span className="field-label">Qué necesita la máquina</span>
          <input className="control" defaultValue={ficha?.necesita?.join(", ") ?? ""} name="necesita" placeholder="carousel-builder, Dropbox sincronizado" />
          <span className="field-help">Separado por comas.</span>
        </label>
        <label className="field full">
          <span className="field-label">Cómo pedírselo a una IA</span>
          <input className="control" defaultValue={ficha?.pedido_ejemplo ?? ""} maxLength={300} name="pedido_ejemplo" placeholder="Hacé un carrusel de P3 Negocios sobre …" />
        </label>
        <label className="field">
          <span className="field-label">Skill</span>
          <input className="control" defaultValue={ficha?.skill?.nombre ?? ""} maxLength={120} name="skill_nombre" placeholder="carrusel-p3-negocios" />
        </label>
        <label className="field">
          <span className="field-label">Repositorio de la skill</span>
          <input className="control" defaultValue={ficha?.skill?.repo ?? ""} name="skill_repo" placeholder="https://github.com/…" type="url" />
          <span className="field-help">La versión no se anota acá: es la última del repositorio, y cada iteración dice con cuál se hizo.</span>
        </label>
        {!familia && (
          <label className="field full">
            <span className="field-label">Instrucciones para la IA</span>
            <textarea className="control" maxLength={4000} name="instrucciones" placeholder="Si lo dejás vacío: «seguí la skill y al terminar registralo»." rows={3} />
          </label>
        )}
      </div>
      <div className="form-actions">
        <button className="button" type="submit">{familia ? "Guardar ficha" : "Crear proceso"}</button>
        <Link className="button secondary" href={cancelarHref}>Cancelar</Link>
      </div>
    </form>
  );
}
