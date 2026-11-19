/**
 * Lo producido no se duplica y se puede borrar de a un archivo, contra PostgreSQL real.
 *
 * Ejerce las funciones reales de `platform/storage/archivos.ts` —importadas, no
 * reescritas— sobre `app_stored_file` y `app_attachment`:
 *
 *   - pedir la subida de un archivo que ya está pendiente con el mismo nombre y el mismo MD5
 *     reutiliza su lugar en vez de crear otro, y suelta los pendientes iguales que sobran;
 *   - pedirla de uno que ya está guardado no crea nada: devuelve el mismo archivo;
 *   - el mismo nombre con otro contenido es otro archivo;
 *   - borrar un archivo guardado saca también su copia en la vista previa (el adjunto con el
 *     mismo nombre y los mismos bytes), salvo que quede otro archivo guardado igual;
 *   - no se borra un archivo pasando otro registro.
 *
 * Requiere una base descartable con las migraciones aplicadas: crea filas con un registro
 * inventado y las borra al terminar. El módulo es sólo de servidor; `alias-loader.mjs`
 * resuelve su marca `server-only` fuera de Next.
 */
import { createHash, randomUUID } from "node:crypto";
import { getPool, sql, withTransaction } from "@/lib/db";
import { marcarGuardado, reservarSubida, soltarProducido, vistaPreviaActual } from "@/platform/storage/archivos";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const ENTIDAD = "prueba_producido";
const registro = randomUUID();
const otroRegistro = randomUUID();
const lamina = Buffer.from("una lámina de prueba");
const md5 = (contenido) => createHash("md5").update(contenido).digest("hex");
const sha256 = (contenido) => createHash("sha256").update(contenido).digest("hex");

function pedido(nombre, contenido, tipo = "image/jpeg") {
  const id = randomUUID();
  return {
    id,
    entityKey: ENTIDAD,
    recordId: registro,
    objectKey: `${ENTIDAD}/${registro}/${id}/${nombre}`,
    nombre,
    tipo,
    tamano: contenido.length,
    md5: md5(contenido),
    persona: null,
  };
}

const reservar = (entrada) => withTransaction((client) => reservarSubida(client, entrada));
const soltar = (recordId, id) => withTransaction((client) => soltarProducido(client, ENTIDAD, recordId, id));
const filas = async () => sql(
  "SELECT id, original_name, md5, status FROM app_stored_file WHERE entity_key = $1 AND record_id = $2 ORDER BY created_at, id",
  [ENTIDAD, registro],
);
const adjuntos = async () => sql(
  "SELECT id, original_name FROM app_attachment WHERE entity_key = $1 AND record_id = $2 ORDER BY original_name",
  [ENTIDAD, registro],
);
async function insertarFila(nombre, contenido, status) {
  const id = randomUUID();
  await sql(
    `INSERT INTO app_stored_file (id, entity_key, record_id, object_key, original_name, content_type, size_bytes, md5, status, stored_at)
     VALUES ($1, $2, $3, $4, $5, 'image/jpeg', $6, $7, $8, CASE WHEN $8 = 'guardado' THEN now() END)`,
    [id, ENTIDAD, registro, `${ENTIDAD}/${registro}/${id}/${nombre}`, nombre, contenido.length, md5(contenido), status],
  );
  return id;
}
async function adjuntar(nombre, contenido) {
  await sql(
    `INSERT INTO app_attachment (entity_key, record_id, original_name, content_type, size_bytes, sha256, content)
     VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6)`,
    [ENTIDAD, registro, nombre, contenido.length, sha256(contenido), contenido],
  );
}

try {
  // Subir: la primera vez crea, repetir reutiliza.
  const primero = await reservar(pedido("slide-01.jpg", lamina));
  comprobar("la primera subida crea un pendiente", primero.estado === "nuevo", primero.estado);
  const segundo = await reservar(pedido("slide-01.jpg", lamina));
  comprobar("repetir la subida de un pendiente igual lo reemplaza: mismo id y misma clave",
    segundo.estado === "reemplazado" && segundo.id === primero.id && segundo.objectKey === primero.objectKey, JSON.stringify(segundo));
  comprobar("y sigue habiendo un solo archivo", (await filas()).length === 1, String((await filas()).length));

  // Un registro que ya quedó duplicado (como antes de esta versión) se ordena al subir de nuevo.
  await insertarFila("slide-01.jpg", lamina, "pendiente");
  const tercero = await reservar(pedido("slide-01.jpg", lamina));
  comprobar("con dos pendientes iguales se reutiliza el primero y se suelta el otro",
    tercero.estado === "reemplazado" && tercero.id === primero.id && tercero.soltados.length === 1, JSON.stringify(tercero));
  comprobar("y vuelve a haber uno solo", (await filas()).length === 1, String((await filas()).length));

  // Ya guardado: no se crea nada.
  await withTransaction((client) => marcarGuardado(client, primero.id));
  const cuarto = await reservar(pedido("slide-01.jpg", lamina, "image/png"));
  comprobar("subir de nuevo un archivo guardado lo reutiliza", cuarto.estado === "ya_guardado" && cuarto.id === primero.id, JSON.stringify(cuarto));
  comprobar("con el tipo que ya tenía, para no cambiarlo en el almacén", cuarto.tipo === "image/jpeg", cuarto.tipo);
  const tras = await filas();
  comprobar("y no aparece un segundo archivo", tras.length === 1 && tras[0].status === "guardado", JSON.stringify(tras));

  // Mismo nombre, otro contenido: es otro archivo.
  const otro = await reservar(pedido("slide-01.jpg", Buffer.from("otra lámina")));
  comprobar("el mismo nombre con otro contenido es otro archivo", otro.estado === "nuevo" && otro.id !== primero.id, JSON.stringify(otro));

  // Borrar un archivo suelto, con su copia en la vista previa.
  const gemelo = await insertarFila("slide-01.jpg", lamina, "guardado");
  await adjuntar("slide-01.jpg", lamina);
  await adjuntar("slide-02.jpg", Buffer.from("la segunda lámina"));
  comprobar("no se borra un archivo pasando otro registro", (await soltar(otroRegistro, gemelo)) === null);
  const sinGemelo = await soltar(registro, gemelo);
  comprobar("borrar un duplicado devuelve su clave para sacarlo del almacén",
    sinGemelo?.archivo.id === gemelo && sinGemelo.archivo.object_key.endsWith("/slide-01.jpg"), JSON.stringify(sinGemelo?.archivo));
  comprobar("y deja la vista previa, porque queda otro archivo igual guardado",
    sinGemelo?.adjuntos.length === 0 && (await adjuntos()).length === 2, JSON.stringify(await adjuntos()));
  const ultimo = await soltar(registro, primero.id);
  comprobar("borrar el último archivo igual saca su copia de la vista previa",
    ultimo?.adjuntos.length === 1 && ultimo.adjuntos[0].original_name === "slide-01.jpg", JSON.stringify(ultimo?.adjuntos));
  const quedan = await adjuntos();
  comprobar("y no toca las otras imágenes", quedan.length === 1 && quedan[0].original_name === "slide-02.jpg", JSON.stringify(quedan));
  const pendiente = await soltar(registro, otro.id);
  comprobar("un pendiente se borra sin tocar la vista previa", pendiente?.adjuntos.length === 0 && (await adjuntos()).length === 1);
  comprobar("borrar dos veces no encuentra nada", (await soltar(registro, primero.id)) === null);
  comprobar("y no queda ningún archivo del registro", (await filas()).length === 0, JSON.stringify(await filas()));

  // La vista previa actual se compara con lo producido por nombre y MD5: el MD5 que calcula
  // la base sobre el contenido del adjunto tiene que ser el mismo que el de lo producido.
  const segunda = Buffer.from("la segunda lámina");
  const actual = await vistaPreviaActual(null, ENTIDAD, registro);
  comprobar("la vista previa actual da el MD5 de cada imagen adjunta, igual al de lo producido",
    actual.total === 1 && actual.imagenes.length === 1 && actual.imagenes[0].original_name === "slide-02.jpg" && actual.imagenes[0].md5 === md5(segunda),
    JSON.stringify(actual));
} finally {
  await sql("DELETE FROM app_stored_file WHERE entity_key = $1", [ENTIDAD]);
  await sql("DELETE FROM app_attachment WHERE entity_key = $1", [ENTIDAD]);
  await getPool().end();
}

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nLo producido: todas las comprobaciones pasaron.");
