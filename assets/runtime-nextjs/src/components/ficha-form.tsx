import Link from "next/link";
import { registroATexto, requisitosATexto, type Definicion } from "@/platform/processes/definition";
import { guardarProcesoAction } from "@/app/procesos/actions";

/**
 * El formulario de un proceso, el mismo para el alta y para la modificación. Sin `familia`
 * lo crea; con `familia` lo cambia en el lugar.
 *
 * Requisitos y registro se escriben una línea por elemento, separando las partes con «|»:
 * es lo más corto que una persona puede escribir sin aprender un formato.
 */
export function FichaForm({ familia, nombre, proceso, cancelarHref }: {
  familia?: string;
  nombre?: string;
  proceso?: Definicion | null;
  cancelarHref: string;
}) {
  const ficha = proceso?.ficha;
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
        </label>
        <label className="field">
          <span className="field-label">Qué hay que darle *</span>
          <textarea className="control" defaultValue={ficha?.entrada ?? ""} maxLength={500} name="entrada" required rows={2} />
        </label>
        <label className="field">
          <span className="field-label">Qué entrega *</span>
          <textarea className="control" defaultValue={ficha?.entrega ?? ""} maxLength={500} name="entrega" required rows={2} />
        </label>
        <label className="field full">
          <span className="field-label">Cómo pedírselo a una IA</span>
          <input className="control" defaultValue={ficha?.pedido_ejemplo ?? ""} maxLength={300} name="pedido_ejemplo" placeholder="Hacé un carrusel de P3 Negocios sobre …" />
        </label>
        <label className="field">
          <span className="field-label">Skill **</span>
          <input className="control" defaultValue={ficha?.skill?.nombre ?? ""} maxLength={120} name="skill_nombre" placeholder="carrusel-p3-negocios" />
        </label>
        <label className="field">
          <span className="field-label">Repositorio de la skill **</span>
          <input className="control" defaultValue={ficha?.skill?.repo ?? ""} name="skill_repo" placeholder="https://github.com/…" type="url" />
        </label>
        <label className="field full">
          <span className="field-label">Carpeta de Dropbox *</span>
          <input className="control" defaultValue={proceso?.carpeta ?? ""} maxLength={500} name="carpeta" placeholder="/Clientes/www.p3planeta.com/p3-negocios/piezas/" required />
          <span className="field-help">Donde va cada iteración, una carpeta por vez. Sin carpeta en Dropbox no se registra nada.</span>
        </label>
        <label className="field full">
          <span className="field-label">Qué necesita la máquina *</span>
          <textarea className="control mono" defaultValue={requisitosATexto(proceso?.requisitos)} name="requisitos" required placeholder={"carousel-builder | skill | que exista .claude/skills/carousel-builder | clonar prc-skills\nPillow | libreria | python -c \"import PIL\" | pip install pillow\nDropbox | conector | que responda list_folder | conectar Dropbox en la app"} rows={6} />
          <span className="field-help">Una línea por requisito: nombre | tipo | cómo comprobarlo | qué hacer si falta. Tipos: skill, libreria, programa, conector, variable, archivo.</span>
        </label>
        <label className="field full">
          <span className="field-label">Qué se registra cada vez *</span>
          <textarea className="control mono" defaultValue={registroATexto(proceso?.registro)} name="registro" required placeholder={"deportista | el deportista y el negocio\nfuentes | los enlaces de cada dato, con dos fuentes por dato\nfotos | autor y licencia de cada foto usada"} rows={5} />
          <span className="field-help">Una línea por dato: clave | qué es | opcional. La clave, en minúsculas y sin espacios. Carpeta, archivos, receta, skill y conversación se registran siempre.</span>
        </label>
        <label className="field full">
          <span className="field-label">Cómo se hace, si no hay skill **</span>
          <textarea className="control" defaultValue={proceso?.metodo ?? ""} maxLength={20000} name="metodo" rows={4} />
          <span className="field-help">* Obligatorio. ** La skill con su repositorio, o esto si no hay skill: uno de los dos. Un proceso incompleto no se guarda.</span>
        </label>
      </div>
      <div className="form-actions">
        <button className="button" type="submit">{familia ? "Guardar" : "Crear proceso"}</button>
        <Link className="button secondary" href={cancelarHref}>Cancelar</Link>
      </div>
    </form>
  );
}
