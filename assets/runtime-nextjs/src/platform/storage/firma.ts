/**
 * Firma AWS Signature V4 para un almacén compatible con S3 (Cloudflare R2, Amazon S3,
 * Supabase Storage, MinIO). Sin dependencias a propósito: así
 * `scripts/test-almacen.mjs` prueba este mismo archivo contra el ejemplo publicado por AWS.
 *
 * Hace dos cosas:
 *   - `urlFirmada`: una dirección que vale unos minutos para subir o bajar un objeto sin
 *     credenciales. Es lo que recibe la IA de quien opera: puede subir ese archivo y nada más.
 *   - `cabecerasFirmadas`: las cabeceras para que el servidor consulte o borre un objeto.
 */
import { createHash, createHmac } from "node:crypto";

export type Credenciales = { accessKeyId: string; secretAccessKey: string; region: string };

const ALGORITMO = "AWS4-HMAC-SHA256";
const SERVICIO = "s3";
const VACIO = createHash("sha256").update("").digest("hex");

/** RFC 3986: todo menos letras, dígitos y `-_.~`. */
export function codificar(valor: string) {
  return encodeURIComponent(valor).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** La ruta canónica de un objeto en estilo ruta: `/<bucket>/<clave>`, cada tramo codificado. */
export function rutaDeObjeto(bucket: string, clave: string) {
  return `/${codificar(bucket)}/${clave.split("/").map(codificar).join("/")}`;
}

function fechas(ahora: Date) {
  const amz = ahora.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return { amz, dia: amz.slice(0, 8) };
}

function hmac(clave: Buffer | string, texto: string) {
  return createHmac("sha256", clave).update(texto, "utf8").digest();
}

function firmar(credenciales: Credenciales, dia: string, textoAFirmar: string) {
  const kDia = hmac(`AWS4${credenciales.secretAccessKey}`, dia);
  const kRegion = hmac(kDia, credenciales.region);
  const kServicio = hmac(kRegion, SERVICIO);
  const kFirma = hmac(kServicio, "aws4_request");
  return createHmac("sha256", kFirma).update(textoAFirmar, "utf8").digest("hex");
}

function consultaCanonica(consulta: Record<string, string>) {
  return Object.keys(consulta)
    .sort()
    .map((clave) => `${codificar(clave)}=${codificar(consulta[clave])}`)
    .join("&");
}

function cabecerasCanonicas(cabeceras: Record<string, string>) {
  const nombres = Object.keys(cabeceras).map((n) => n.toLowerCase()).sort();
  const porNombre = Object.fromEntries(Object.entries(cabeceras).map(([n, v]) => [n.toLowerCase(), v]));
  return {
    canonicas: nombres.map((n) => `${n}:${String(porNombre[n]).trim().replace(/\s+/g, " ")}\n`).join(""),
    firmadas: nombres.join(";"),
  };
}

function textoAFirmar(amz: string, alcance: string, pedidoCanonico: string) {
  return [ALGORITMO, amz, alcance, createHash("sha256").update(pedidoCanonico, "utf8").digest("hex")].join("\n");
}

/**
 * Una dirección firmada que vale `segundos`. Las `cabeceras` quedan dentro de la firma: quien
 * la use tiene que mandarlas iguales (por ejemplo Content-MD5, que hace que el almacén
 * rechace un archivo distinto del declarado).
 */
export function urlFirmada(entrada: {
  metodo: "GET" | "PUT";
  origen: string;
  ruta: string;
  credenciales: Credenciales;
  segundos: number;
  ahora?: Date;
  cabeceras?: Record<string, string>;
  consulta?: Record<string, string>;
}) {
  const host = new URL(entrada.origen).host;
  const { amz, dia } = fechas(entrada.ahora ?? new Date());
  const alcance = `${dia}/${entrada.credenciales.region}/${SERVICIO}/aws4_request`;
  const { canonicas, firmadas } = cabecerasCanonicas({ host, ...(entrada.cabeceras ?? {}) });
  const consulta: Record<string, string> = {
    ...(entrada.consulta ?? {}),
    "X-Amz-Algorithm": ALGORITMO,
    "X-Amz-Credential": `${entrada.credenciales.accessKeyId}/${alcance}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(Math.max(1, Math.min(604_800, Math.floor(entrada.segundos)))),
    "X-Amz-SignedHeaders": firmadas,
  };
  const query = consultaCanonica(consulta);
  const pedido = [entrada.metodo, entrada.ruta, query, canonicas, firmadas, "UNSIGNED-PAYLOAD"].join("\n");
  const firma = firmar(entrada.credenciales, dia, textoAFirmar(amz, alcance, pedido));
  return `${new URL(entrada.origen).origin}${entrada.ruta}?${query}&X-Amz-Signature=${firma}`;
}

/** Las cabeceras para un pedido sin cuerpo que hace el servidor: consultar o borrar un objeto. */
export function cabecerasFirmadas(entrada: {
  metodo: "HEAD" | "DELETE" | "GET";
  origen: string;
  ruta: string;
  credenciales: Credenciales;
  ahora?: Date;
}) {
  const host = new URL(entrada.origen).host;
  const { amz, dia } = fechas(entrada.ahora ?? new Date());
  const alcance = `${dia}/${entrada.credenciales.region}/${SERVICIO}/aws4_request`;
  const propias = { "x-amz-content-sha256": VACIO, "x-amz-date": amz };
  const { canonicas, firmadas } = cabecerasCanonicas({ host, ...propias });
  const pedido = [entrada.metodo, entrada.ruta, "", canonicas, firmadas, VACIO].join("\n");
  const firma = firmar(entrada.credenciales, dia, textoAFirmar(amz, alcance, pedido));
  return {
    ...propias,
    authorization: `${ALGORITMO} Credential=${entrada.credenciales.accessKeyId}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`,
  };
}

/**
 * Las cabeceras para consultar un objeto. Se pide sin compresión: fetch pide gzip por
 * defecto, y para los tipos de texto el almacén puede responder comprimido, con otro tamaño
 * y una ETag débil que ya no es el MD5. Pasó con R2: los JPG se confirmaban y los .md se
 * descartaban siempre.
 */
export function cabecerasDeConsulta(entrada: { origen: string; ruta: string; credenciales: Credenciales; ahora?: Date }) {
  return { ...cabecerasFirmadas({ ...entrada, metodo: "HEAD" }), "accept-encoding": "identity" };
}

/**
 * Lo que dice la respuesta a una consulta: tamaño, ETag sin comillas y si vino comprimida.
 * Una ETag débil (W/"…") o una respuesta comprimida no describen los bytes guardados: el
 * tamaño y el MD5 no se pueden comparar, y quien confirma tiene que saberlo en vez de
 * descartar el archivo como si fuera otro.
 */
export function datosDeConsulta(cabeceras: { get(nombre: string): string | null }) {
  const codificacion = (cabeceras.get("content-encoding") ?? "").trim().toLowerCase();
  const crudo = (cabeceras.get("etag") ?? "").trim();
  return {
    tamano: Number(cabeceras.get("content-length") ?? 0),
    etag: crudo.replace(/^W\//i, "").replace(/"/g, "").toLowerCase(),
    alterada: (codificacion !== "" && codificacion !== "identity") || /^W\//i.test(crudo),
  };
}
