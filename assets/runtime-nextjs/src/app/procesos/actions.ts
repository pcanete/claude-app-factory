"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { USER_SCOPES } from "@/platform/mcp/store";
import { redirect } from "next/navigation";
import type { Ficha } from "@/platform/processes/definition";
import {
  adjuntarACaso,
  cancelarCaso,
  crearProceso,
  nuevaVersionDeProceso,
  reactivarProceso,
  retirarProceso,
} from "@/platform/processes/engine";

/**
 * Sube un archivo a una iteración desde el panel. Uno por llamada, a propósito: Vercel corta
 * los pedidos de más de 4,5 MB, y nueve láminas juntas lo superan. El componente que llama
 * los manda de a uno y muestra el avance.
 */
export async function subirArchivoAIteracionAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const caso = String(formData.get("caso") ?? "");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, error: "No llegó ningún archivo." };
  try {
    await adjuntarACaso(
      { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" },
      caso,
      [{ nombre: archivo.name, tipo: archivo.type || "application/octet-stream", contenido: Buffer.from(await archivo.arrayBuffer()) }],
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo subir el archivo." };
  }
  revalidatePath("/procesos", "layout");
  return { ok: true };
}

/** Cancelar un caso desde la página del proceso. El motor exige que quien lo pide administre. */
export async function cancelarCasoAction(formData: FormData) {
  const user = await requireUser();
  const caso = String(formData.get("caso") ?? "");
  const familia = String(formData.get("familia") ?? "");
  const motivo = String(formData.get("motivo") ?? "").trim();
  let error: string | null = null;
  try {
    await cancelarCaso({ id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" }, caso, motivo);
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo cancelar el caso.";
  }
  revalidatePath("/procesos", "layout");
  revalidatePath("/pendientes");
  const destino = `/procesos/${encodeURIComponent(familia)}`;
  redirect(error ? `${destino}?error=${encodeURIComponent(error)}` : `${destino}?hecho=${encodeURIComponent("Caso cancelado.")}`);
}

function persona(user: Awaited<ReturnType<typeof requireUser>>) {
  return { id: user.id, name: user.displayName, roleKey: user.roleKey, scopes: [...USER_SCOPES], kind: "user" as const };
}

function texto(formData: FormData, campo: string) {
  const valor = String(formData.get(campo) ?? "").trim();
  return valor || undefined;
}

/** La ficha tal como viene del formulario: sólo los campos con contenido. */
function fichaDelFormulario(formData: FormData): Ficha {
  const necesita = String(formData.get("necesita") ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  const skillNombre = texto(formData, "skill_nombre");
  const ficha: Ficha = {
    resumen: texto(formData, "resumen"),
    entrada: texto(formData, "entrada"),
    entrega: texto(formData, "entrega"),
    pedido_ejemplo: texto(formData, "pedido_ejemplo"),
    ...(necesita.length ? { necesita } : {}),
    ...(skillNombre ? {
      skill: {
        nombre: skillNombre,
        ...(texto(formData, "skill_version") ? { version: texto(formData, "skill_version") } : {}),
        ...(texto(formData, "skill_repo") ? { repo: texto(formData, "skill_repo") } : {}),
      },
    } : {}),
  };
  return Object.fromEntries(Object.entries(ficha).filter(([, valor]) => valor !== undefined)) as Ficha;
}

/** Alta (sin familia) o modificación (con familia: publica la versión siguiente). */
export async function guardarProcesoAction(formData: FormData) {
  const user = await requireUser();
  const familia = texto(formData, "familia");
  const nombre = texto(formData, "nombre") ?? "";
  const ficha = fichaDelFormulario(formData);
  let destino = "/procesos";
  let error: string | null = null;
  let hecho = "";
  try {
    if (familia) {
      const r = await nuevaVersionDeProceso(persona(user), familia, { nombre, ficha });
      destino = `/procesos/${encodeURIComponent(familia)}`;
      hecho = r.mensaje;
    } else {
      const r = await crearProceso(persona(user), { nombre, ficha, instrucciones: texto(formData, "instrucciones") });
      destino = `/procesos/${encodeURIComponent(r.familia)}`;
      hecho = r.mensaje;
    }
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo guardar el proceso.";
  }
  revalidatePath("/procesos", "layout");
  if (error) {
    const volver = familia ? `/procesos/${encodeURIComponent(familia)}/editar` : "/procesos/nuevo";
    redirect(`${volver}?error=${encodeURIComponent(error)}`);
  }
  redirect(`${destino}?hecho=${encodeURIComponent(hecho)}`);
}

export async function retirarProcesoAction(formData: FormData) {
  const user = await requireUser();
  const familia = String(formData.get("familia") ?? "");
  let error: string | null = null;
  let hecho = "";
  try {
    hecho = (await retirarProceso(persona(user), familia, String(formData.get("motivo") ?? ""))).mensaje;
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo retirar el proceso.";
  }
  revalidatePath("/procesos", "layout");
  const destino = `/procesos/${encodeURIComponent(familia)}`;
  redirect(error ? `${destino}?error=${encodeURIComponent(error)}` : `${destino}?hecho=${encodeURIComponent(hecho)}`);
}

export async function reactivarProcesoAction(formData: FormData) {
  const user = await requireUser();
  const familia = String(formData.get("familia") ?? "");
  let error: string | null = null;
  let hecho = "";
  try {
    hecho = (await reactivarProceso(persona(user), familia)).mensaje;
  } catch (causa) {
    error = causa instanceof Error ? causa.message : "No se pudo reactivar el proceso.";
  }
  revalidatePath("/procesos", "layout");
  const destino = `/procesos/${encodeURIComponent(familia)}`;
  redirect(error ? `${destino}?error=${encodeURIComponent(error)}` : `${destino}?hecho=${encodeURIComponent(hecho)}`);
}
