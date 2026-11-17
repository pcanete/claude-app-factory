import "server-only";
import { cabecerasDeConsulta, cabecerasFirmadas, datosDeConsulta, rutaDeObjeto, urlFirmada, type Credenciales } from "@/platform/storage/firma";

/**
 * El almacén propio de la aplicación: un bucket compatible con S3 donde guarda lo producido.
 *
 * Se configura con cuatro variables; sin ellas no hay almacén y la aplicación sigue como
 * antes, con lo producido en Dropbox. Las credenciales viven sólo en el servidor: quien opera
 * recibe direcciones firmadas que valen unos minutos y sirven para un solo archivo.
 *
 *   ALMACEN_S3_ENDPOINT           https://<cuenta>.r2.cloudflarestorage.com
 *   ALMACEN_S3_BUCKET             el bucket, privado
 *   ALMACEN_S3_ACCESS_KEY_ID
 *   ALMACEN_S3_SECRET_ACCESS_KEY
 *   ALMACEN_S3_REGION             opcional: «auto» para R2
 */
type Configuracion = { origen: string; bucket: string; credenciales: Credenciales };

function configuracion(): Configuracion | null {
  const origen = process.env.ALMACEN_S3_ENDPOINT?.trim();
  const bucket = process.env.ALMACEN_S3_BUCKET?.trim();
  const accessKeyId = process.env.ALMACEN_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.ALMACEN_S3_SECRET_ACCESS_KEY?.trim();
  if (!origen || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    origen: origen.replace(/\/+$/, ""),
    bucket,
    credenciales: { accessKeyId, secretAccessKey, region: process.env.ALMACEN_S3_REGION?.trim() || "auto" },
  };
}

export function almacenConfigurado() {
  return configuracion() !== null;
}

function exigir() {
  const config = configuracion();
  if (!config) throw new Error("Esta aplicación no tiene almacén configurado.");
  return config;
}

/** Hasta 5 GB: el máximo de una subida de una sola vez en S3 y en R2. */
export const MAXIMO_POR_ARCHIVO = 5 * 1024 * 1024 * 1024;

/**
 * Para subir un archivo: un PUT a esta dirección con estas cabeceras. El Content-MD5 va
 * firmado, así que el almacén rechaza un archivo distinto del que se declaró.
 */
export function direccionDeSubida(clave: string, entrada: { md5Base64: string; tipo: string }, segundos = 3600) {
  const config = exigir();
  const cabeceras = { "content-md5": entrada.md5Base64, "content-type": entrada.tipo };
  return {
    url: urlFirmada({ metodo: "PUT", origen: config.origen, ruta: rutaDeObjeto(config.bucket, clave), credenciales: config.credenciales, segundos, cabeceras }),
    cabeceras: { "Content-MD5": entrada.md5Base64, "Content-Type": entrada.tipo },
    vence: new Date(Date.now() + segundos * 1000).toISOString(),
  };
}

/** Para bajar un archivo, con su nombre original. */
export function direccionDeDescarga(clave: string, entrada: { nombre: string; tipo: string }, segundos = 3600) {
  const config = exigir();
  const ascii = entrada.nombre.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "archivo";
  return {
    url: urlFirmada({
      metodo: "GET",
      origen: config.origen,
      ruta: rutaDeObjeto(config.bucket, clave),
      credenciales: config.credenciales,
      segundos,
      consulta: {
        "response-content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(entrada.nombre)}`,
        "response-content-type": entrada.tipo,
      },
    }),
    vence: new Date(Date.now() + segundos * 1000).toISOString(),
  };
}

/**
 * Qué hay en el almacén con esa clave: tamaño y ETag (el MD5 en una subida de una vez), sin
 * compresión (ver cabecerasDeConsulta). Null si no está.
 */
export async function consultarObjeto(clave: string): Promise<{ tamano: number; etag: string; alterada: boolean } | null> {
  const config = exigir();
  const ruta = rutaDeObjeto(config.bucket, clave);
  const respuesta = await fetch(`${config.origen}${ruta}`, {
    method: "HEAD",
    headers: cabecerasDeConsulta({ origen: config.origen, ruta, credenciales: config.credenciales }),
    cache: "no-store",
  });
  if (respuesta.status === 404) return null;
  if (!respuesta.ok) throw new Error(`El almacén respondió ${respuesta.status} al consultar un archivo.`);
  return datosDeConsulta(respuesta.headers);
}

/**
 * Lee un objeto entero, sin compresión. Para archivos chicos que el servidor necesita
 * tener (las imágenes que pasan a vista previa): lo pesado se baja con una dirección
 * firmada, no a través del servidor.
 */
export async function leerObjeto(clave: string): Promise<Buffer> {
  const config = exigir();
  const ruta = rutaDeObjeto(config.bucket, clave);
  const respuesta = await fetch(`${config.origen}${ruta}`, {
    method: "GET",
    headers: {
      ...cabecerasFirmadas({ metodo: "GET", origen: config.origen, ruta, credenciales: config.credenciales }),
      "accept-encoding": "identity",
    },
    cache: "no-store",
  });
  if (!respuesta.ok) throw new Error(`El almacén respondió ${respuesta.status} al leer un archivo.`);
  return Buffer.from(await respuesta.arrayBuffer());
}

/** Borra un objeto. Que ya no esté no es un error. */
export async function borrarObjeto(clave: string) {
  const config = exigir();
  const ruta = rutaDeObjeto(config.bucket, clave);
  const respuesta = await fetch(`${config.origen}${ruta}`, {
    method: "DELETE",
    headers: cabecerasFirmadas({ metodo: "DELETE", origen: config.origen, ruta, credenciales: config.credenciales }),
    cache: "no-store",
  });
  if (!respuesta.ok && respuesta.status !== 404) throw new Error(`El almacén respondió ${respuesta.status} al borrar un archivo.`);
}
