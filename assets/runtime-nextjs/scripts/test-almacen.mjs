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
import { cabecerasFirmadas, codificar, rutaDeObjeto, urlFirmada } from "../src/platform/storage/firma.ts";

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

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nAlmacén: todas las comprobaciones pasaron.");
