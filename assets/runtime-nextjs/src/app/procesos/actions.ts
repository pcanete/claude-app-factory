"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { registroDeTexto, requisitosDeTexto, type Ficha } from "@/platform/processes/definition";
import {
  adjuntarAIteracion,
  borrarIteracion,
  borrarProceso,
  crearProceso,
  editarProceso,
  reactivarProceso,
  retirarProceso,
} from "@/platform/processes/engine";

function persona(user: Awaited<ReturnType<typeof requireUser>>) {
  return { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" as const };
}

function texto(formData: FormData, campo: string) {
  const valor = String(formData.get(campo) ?? "").trim();
  return valor || undefined;
}

function volver(destino: string, resultado: { error?: string | null; hecho?: string }) {
  revalidatePath("/procesos", "layout");
  redirect(resultado.error
    ? `${destino}?error=${encodeURIComponent(resultado.error)}`
    : `${destino}?hecho=${encodeURIComponent(resultado.hecho ?? "Listo.")}`);
}

function mensajeDe(error: unknown, porDefecto: string) {
  return error instanceof Error ? error.message : porDefecto;
}

/**
 * Sube un archivo a una iteración desde el panel. Uno por llamada: Vercel corta los pedidos
 * de más de 4,5 MB, y nueve láminas juntas lo superan.
 */
export async function subirArchivoAIteracionAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const iteracion = String(formData.get("iteracion") ?? "");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "No llegó ningún archivo." };
  try {
    await adjuntarAIteracion(persona(user), iteracion, [
      { nombre: archivo.name, tipo: archivo.type || "application/octet-stream", contenido: Buffer.from(await archivo.arrayBuffer()) },
    ]);
  } catch (error) {
    return { ok: false, error: mensajeDe(error, "No se pudo subir el archivo.") };
  }
  revalidatePath("/procesos", "layout");
  return { ok: true };
}

/** Alta (sin familia) o modificación en el lugar (con familia). */
export async function guardarProcesoAction(formData: FormData) {
  const user = await requireUser();
  const familia = texto(formData, "familia");
  const skillNombre = texto(formData, "skill_nombre");
  const skillRepo = texto(formData, "skill_repo");
  const ficha = Object.fromEntries(Object.entries({
    resumen: texto(formData, "resumen"),
    entrada: texto(formData, "entrada"),
    entrega: texto(formData, "entrega"),
    pedido_ejemplo: texto(formData, "pedido_ejemplo"),
    ...(skillNombre ? { skill: { nombre: skillNombre, ...(skillRepo ? { repo: skillRepo } : {}) } } : {}),
  }).filter(([, valor]) => valor !== undefined)) as Ficha;
  const requisitos = requisitosDeTexto(String(formData.get("requisitos") ?? ""));
  const registro = registroDeTexto(String(formData.get("registro") ?? ""));
  const formulario = familia ? `/procesos/${encodeURIComponent(familia)}/editar` : "/procesos/nuevo";
  const errores = [...requisitos.errores.map((e) => `Requisitos, ${e}`), ...registro.errores.map((e) => `Registro, ${e}`)];
  if (errores.length) volver(formulario, { error: errores.join(" ") });

  const datos = {
    nombre: texto(formData, "nombre") ?? "",
    ficha,
    metodo: texto(formData, "metodo"),
    requisitos: requisitos.requisitos,
    registro: registro.registro,
    carpeta: texto(formData, "carpeta"),
  };
  let destino = formulario;
  let error: string | null = null;
  let hecho = "";
  try {
    if (familia) {
      hecho = (await editarProceso(persona(user), familia, datos)).mensaje;
      destino = `/procesos/${encodeURIComponent(familia)}`;
    } else {
      const r = await crearProceso(persona(user), datos);
      hecho = r.mensaje;
      destino = `/procesos/${encodeURIComponent(r.familia)}`;
    }
  } catch (causa) {
    error = mensajeDe(causa, "No se pudo guardar el proceso.");
    destino = formulario;
  }
  volver(destino, { error, hecho });
}

async function sobreFamilia(formData: FormData, accion: (familia: string) => Promise<{ mensaje: string }>, destinoTrasHecho?: string) {
  const familia = String(formData.get("familia") ?? "");
  let error: string | null = null;
  let hecho = "";
  try {
    hecho = (await accion(familia)).mensaje;
  } catch (causa) {
    error = mensajeDe(causa, "No se pudo hacer.");
  }
  volver(error || !destinoTrasHecho ? `/procesos/${encodeURIComponent(familia)}` : destinoTrasHecho, { error, hecho });
}

export async function retirarProcesoAction(formData: FormData) {
  const user = await requireUser();
  await sobreFamilia(formData, (familia) => retirarProceso(persona(user), familia));
}

export async function reactivarProcesoAction(formData: FormData) {
  const user = await requireUser();
  await sobreFamilia(formData, (familia) => reactivarProceso(persona(user), familia));
}

export async function borrarProcesoAction(formData: FormData) {
  const user = await requireUser();
  await sobreFamilia(formData, (familia) => borrarProceso(persona(user), familia), "/procesos");
}

export async function borrarIteracionAction(formData: FormData) {
  const user = await requireUser();
  const iteracion = String(formData.get("iteracion") ?? "");
  await sobreFamilia(formData, () => borrarIteracion(persona(user), iteracion));
}
