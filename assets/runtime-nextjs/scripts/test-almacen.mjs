/**
 * Pruebas de la firma del almacén propio.
 *
 * Importa el módulo real (`platform/storage/firma.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - la firma da exactamente la del ejemplo publicado por AWS para una URL prefirmada: si
 *     difiere en un carácter, el almacén rechaza todas las subidas;
 *   - las cabeceras que se firman (Content-MD5) quedan declaradas en la dirección: sin eso
 *     el almacén aceptaría un archivo distinto del declarado;
 *   - la clave de un objeto con espacios, acentos o eñes se codifica tramo por tramo y la
 *     barra que separa carpetas no se codifica;
 *   - una dirección no vale más de lo que se pidió, ni más de siete días.
 */
import { cabecerasDeConsulta, cabecerasFirmadas, codificar, datosDeConsulta, rutaDeObjeto, urlFirmada } from "../src/platform/storage/firma.ts";
import { enParalelo } from "../src/lib/en-paralelo.ts";
import { elegirVistaPrevia } from "../src/platform/storage/vista-previa.ts";
import { claveDeArchivo, separarRepetidos, sinRepetidos } from "../src/platform/storage/repetidos.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

// El ejemplo de «Authenticating Requests: Using Query Parameters (AWS Signature Version 4)».
const AWS = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };
const ejemplo = urlFirmada({
  metodo: "GET",
  origen: "https://examplebucket.s3.amazonaws.com",
  ruta: "/test.txt",
  credenciales: AWS,
  segundos: 86400,
  ahora: new Date("2013-05-24T00:00:00Z"),
});
comprobar("la firma es la del ejemplo de AWS",
  ejemplo.endsWith("X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404"), ejemplo);
comprobar("y la dirección tiene la forma del ejemplo",
  ejemplo.startsWith("https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&"), ejemplo);

const R2 = { accessKeyId: "id", secretAccessKey: "secreto", region: "auto" };
const subida = urlFirmada({
  metodo: "PUT",
  origen: "https://cuenta.r2.cloudflarestorage.com",
  ruta: rutaDeObjeto("mi-bucket", "iteracion/abc/def/Federer y On – final.mp4"),
  credenciales: R2,
  segundos: 3600,
  cabeceras: { "content-md5": "1B2M2Y8AsgTpgAmY7PhCfg==", "content-type": "video/mp4" },
});
comprobar("una subida firma el Content-MD5 y el tipo", subida.includes("X-Amz-SignedHeaders=content-md5%3Bcontent-type%3Bhost"), subida);
comprobar("con una firma de 64 hexadecimales", /X-Amz-Signature=[0-9a-f]{64}$/.test(subida), subida);

const ruta = rutaDeObjeto("mi-bucket", "iteracion/abc/Peña año (1).jpg");
comprobar("la clave se codifica por tramos y conserva las barras",
  ruta === "/mi-bucket/iteracion/abc/Pe%C3%B1a%20a%C3%B1o%20%281%29.jpg", ruta);
comprobar("codificar sigue RFC 3986", codificar("a b!*'()~-_.") === "a%20b%21%2A%27%28%29~-_.");

const larga = urlFirmada({ metodo: "GET", origen: "https://x.example", ruta: "/b/k", credenciales: R2, segundos: 99_999_999 });
comprobar("una dirección no vale más de siete días", larga.includes("X-Amz-Expires=604800"), larga);

const cabeceras = cabecerasFirmadas({ metodo: "HEAD", origen: "https://cuenta.r2.cloudflarestorage.com", ruta: "/mi-bucket/k", credenciales: R2, ahora: new Date("2026-11-16T12:00:00Z") });
comprobar("consultar un objeto firma host, fecha y hash vacío",
  cabeceras.authorization.startsWith("AWS4-HMAC-SHA256 Credential=id/20261116/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=")
  && cabeceras["x-amz-date"] === "20261116T120000Z"
  && cabeceras["x-amz-content-sha256"] === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", JSON.stringify(cabeceras));

const consulta = cabecerasDeConsulta({ origen: "https://cuenta.r2.cloudflarestorage.com", ruta: "/mi-bucket/k", credenciales: R2, ahora: new Date("2026-11-16T12:00:00Z") });
comprobar("la consulta pide la respuesta sin comprimir", consulta["accept-encoding"] === "identity", JSON.stringify(consulta));
comprobar("y la firma es la misma que sin esa cabecera (no se firma)", consulta.authorization === cabeceras.authorization, JSON.stringify(consulta));

// La consulta de un objeto: una respuesta comprimida o con ETag débil no describe los bytes guardados.
const entera = datosDeConsulta(new Headers({ "content-length": "1234", etag: '"D41D8CD98F00B204E9800998ECF8427E"' }));
comprobar("una respuesta entera da tamaño y MD5 en minúsculas sin comillas",
  entera.tamano === 1234 && entera.etag === "d41d8cd98f00b204e9800998ecf8427e" && entera.alterada === false, JSON.stringify(entera));
const identidad = datosDeConsulta(new Headers({ "content-length": "10", etag: '"abc"', "content-encoding": "identity" }));
comprobar("content-encoding identity no cuenta como alterada", identidad.alterada === false, JSON.stringify(identidad));
const gzip = datosDeConsulta(new Headers({ "content-length": "612", etag: '"abc"', "content-encoding": "gzip" }));
comprobar("una respuesta en gzip queda marcada como alterada", gzip.alterada === true, JSON.stringify(gzip));
const debil = datosDeConsulta(new Headers({ etag: 'W/"d41d8cd98f00b204e9800998ecf8427e"' }));
comprobar("una ETag débil queda marcada como alterada y sin el W/",
  debil.alterada === true && debil.etag === "d41d8cd98f00b204e9800998ecf8427e", JSON.stringify(debil));

// Las consultas de confirmar van en paralelo: el orden del resultado tiene que ser el de
// la entrada (si no, se confirma un archivo con el tamaño de otro) y no más de N a la vez.
let enVuelo = 0;
let maximoEnVuelo = 0;
const esperas = [50, 5, 30, 1, 20, 10, 40, 2, 15, 25, 3];
const ordenados = await enParalelo(esperas, 4, async (ms, i) => {
  enVuelo += 1;
  maximoEnVuelo = Math.max(maximoEnVuelo, enVuelo);
  await new Promise((r) => setTimeout(r, ms));
  enVuelo -= 1;
  return `${i}:${ms}`;
});
comprobar("en paralelo devuelve en el orden de la entrada aunque terminen en otro orden",
  ordenados.join(",") === esperas.map((ms, i) => `${i}:${ms}`).join(","), ordenados.join(","));
comprobar("y nunca tiene más en vuelo que el límite", maximoEnVuelo === 4, String(maximoEnVuelo));
comprobar("una lista vacía no espera nada", (await enParalelo([], 8, async () => 1)).length === 0);
let fallo = null;
try { await enParalelo([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error("dos"); return n; }); } catch (e) { fallo = e.message; }
comprobar("si una consulta falla, falla todo", fallo === "dos", String(fallo));

// La vista previa sale de lo producido: sólo imágenes que el panel acepta, en orden de nombre.
const politica = { maxFiles: 3, maxSizeBytes: 1000, allowedTypes: ["image/jpeg", "image/png", "application/pdf"] };
const producido = [
  { original_name: "slide-10.jpg", content_type: "image/jpeg", size_bytes: 500, md5: "a".repeat(32) },
  { original_name: "caption.txt", content_type: "text/plain", size_bytes: 100, md5: "b".repeat(32) },
  { original_name: "slide-2.jpg", content_type: "IMAGE/JPEG", size_bytes: 500, md5: "c".repeat(32) },
  { original_name: "final.mp4", content_type: "video/mp4", size_bytes: 900, md5: "d".repeat(32) },
  { original_name: "slide-1.jpg", content_type: "image/jpeg", size_bytes: 500, md5: "e".repeat(32) },
  { original_name: "enorme.png", content_type: "image/png", size_bytes: 5000, md5: "f".repeat(32) },
  { original_name: "raro.gif", content_type: "image/gif", size_bytes: 10, md5: "0".repeat(32) },
  { original_name: "guion.pdf", content_type: "application/pdf", size_bytes: 10, md5: "1".repeat(32) },
];
const elegidas = elegirVistaPrevia(producido, politica).map((a) => a.original_name);
comprobar("la vista previa toma sólo imágenes admitidas y en orden natural (2 antes que 10)",
  elegidas.join(",") === "slide-1.jpg,slide-2.jpg,slide-10.jpg", elegidas.join(","));
comprobar("deja afuera la imagen que supera el tamaño, la de un tipo no admitido, el PDF y el video",
  !elegidas.some((n) => ["enorme.png", "raro.gif", "guion.pdf", "final.mp4", "caption.txt"].includes(n)), elegidas.join(","));
comprobar("y no pasa del máximo de archivos",
  elegirVistaPrevia(producido, { ...politica, maxFiles: 2 }).length === 2);
comprobar("con comodín image/* también admite el gif",
  elegirVistaPrevia(producido, { ...politica, allowedTypes: ["image/*"], maxFiles: 10 }).some((a) => a.original_name === "raro.gif"));
comprobar("sin imágenes no hay vista previa",
  elegirVistaPrevia(producido.filter((a) => !a.content_type.toLowerCase().startsWith("image/")), politica).length === 0);

// Una subida repetida dejó cada lámina dos veces: la vista previa la toma una sola vez.
const duplicado = [...producido, ...producido.map((a) => ({ ...a, md5: a.md5.toUpperCase() }))];
const sinDuplicar = elegirVistaPrevia(duplicado, { ...politica, maxFiles: 10 }).map((a) => a.original_name);
comprobar("la vista previa no repite una imagen guardada dos veces (mismo nombre y MD5)",
  sinDuplicar.join(",") === "slide-1.jpg,slide-2.jpg,slide-10.jpg", sinDuplicar.join(","));
comprobar("pero sí toma dos imágenes con el mismo nombre y otro contenido",
  elegirVistaPrevia([...producido, { ...producido[0], md5: "9".repeat(32) }], { ...politica, maxFiles: 10 }).filter((a) => a.original_name === "slide-10.jpg").length === 2);

// Cuándo dos archivos de lo producido son el mismo: mismo nombre y mismo MD5.
comprobar("la clave no distingue mayúsculas en el MD5",
  claveDeArchivo({ original_name: "a.jpg", md5: "AB".repeat(16) }) === claveDeArchivo({ original_name: "a.jpg", md5: "ab".repeat(16) }));
comprobar("y sí distingue el nombre",
  claveDeArchivo({ original_name: "a.jpg", md5: "ab".repeat(16) }) !== claveDeArchivo({ original_name: "b.jpg", md5: "ab".repeat(16) }));
const guardados = [{ id: "g1", original_name: "slide-01.jpg", md5: "1".repeat(32) }];
const pendientes = [
  { id: "p1", original_name: "slide-01.jpg", md5: "1".repeat(32) },
  { id: "p2", original_name: "README.md", md5: "2".repeat(32) },
  { id: "p3", original_name: "README.md", md5: "2".repeat(32) },
  { id: "p4", original_name: "slide-01.jpg", md5: "3".repeat(32) },
];
const separados = separarRepetidos(guardados, pendientes);
comprobar("un pendiente igual a uno guardado es repetido, y de dos pendientes iguales queda el primero",
  separados.repetidos.map((a) => a.id).join(",") === "p1,p3", separados.repetidos.map((a) => a.id).join(","));
comprobar("un archivo con el mismo nombre y otro contenido no es repetido",
  separados.unicos.map((a) => a.id).join(",") === "p2,p4", separados.unicos.map((a) => a.id).join(","));
comprobar("sin repetidos conserva el orden de llegada",
  sinRepetidos([...pendientes, ...pendientes]).map((a) => a.id).join(",") === "p1,p2,p4");

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nAlmacén: todas las comprobaciones pasaron.");
