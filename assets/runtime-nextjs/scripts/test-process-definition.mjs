/**
 * Pruebas de qué es un proceso y qué es una iteración.
 *
 * Importa el módulo real (`platform/processes/definition.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - un proceso declara requisitos que se pueden comprobar y qué se registra cada vez, y
 *     una definición mal escrita se rechaza diciendo dónde;
 *   - una definición vieja, con etapas, se sigue leyendo;
 *   - una iteración sin carpeta de Dropbox o sin archivos no se registra;
 *   - una iteración sin los datos que pide su proceso no se registra, y lo opcional no se exige;
 *   - la guía dice qué comprobar en la máquina, dónde guardar y qué registrar;
 *   - un proceso no se guarda si le falta algo de la ficha, sea quien sea el que lo guarde;
 *   - requisitos y registro escritos por una persona, una línea por elemento, se entienden
 *     y vuelven a texto igual.
 */
import {
  claveDeNombre,
  datosFaltantes,
  esCarpetaDeDropbox,
  esEnlaceDeConversacion,
  faltasDeFicha,
  faltasDeIteracion,
  faltasDeReceta,
  familiaDe,
  guiaDeProceso,
  nombreDeFamilia,
  registroATexto,
  registroDeTexto,
  requisitosATexto,
  requisitosDeTexto,
  resumenCorto,
  skillDeIteracion,
  validarDefinicion,
} from "../src/platform/processes/definition.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? `\n         ${detalle}` : ""}`);
  }
}

// --- El proceso --------------------------------------------------------------------------
const definicion = {
  proceso: "carrusel-p3-negocios",
  ficha: { resumen: "El negocio de un deportista en 9 láminas.", skill: { nombre: "carrusel-p3-negocios", repo: "https://github.com/x/prc-skills" } },
  requisitos: [
    { nombre: "carousel-builder", tipo: "skill", verificar: "existe .claude/skills/carousel-builder", instalar: "clonar prc-skills" },
    { nombre: "Pillow", tipo: "libreria", verificar: "python -c \"import PIL\"", instalar: "pip install pillow" },
    { nombre: "Dropbox", tipo: "conector", verificar: "list_folder responde" },
  ],
  registro: [
    { clave: "deportista", descripcion: "el deportista y el negocio" },
    { clave: "fuentes", descripcion: "los enlaces de cada dato" },
    { clave: "nota", descripcion: "algo para la próxima", requerido: false },
  ],
  carpeta: "/Clientes/www.p3planeta.com/p3-negocios/piezas/",
};
const valida = validarDefinicion(definicion);
comprobar("una definición completa valida", valida.ok, JSON.stringify(valida.errores ?? []));
comprobar("y conserva requisitos, registro y carpeta",
  valida.ok && valida.definicion.requisitos.length === 3 && valida.definicion.registro.length === 3 && valida.definicion.carpeta === definicion.carpeta);

const mala = validarDefinicion({
  requisitos: [{ nombre: "x", tipo: "plugin" }, { tipo: "skill", verificar: "y" }],
  registro: [{ clave: "Con Espacios", descripcion: "x" }, { clave: "a", descripcion: "" }, { clave: "a", descripcion: "otra" }],
  ficha: { skill: { nombre: "x", repo: "github.com/x" }, resumen: "x".repeat(201) },
});
const errores = mala.ok ? [] : mala.errores;
comprobar("rechaza un tipo de requisito que no existe y uno sin cómo comprobarlo",
  errores.some((e) => e.includes("requisito 1") && e.includes("tipo")) && errores.some((e) => e.includes("requisito 1") && e.includes("verificar")) && errores.some((e) => e.includes("requisito 2") && e.includes("nombre")), JSON.stringify(errores));
comprobar("rechaza claves de registro inválidas, sin descripción o repetidas",
  errores.some((e) => e.includes("dato 1")) && errores.some((e) => e.includes("dato 2") && e.includes("descripción")) && errores.some((e) => e.includes("repite")), JSON.stringify(errores));
comprobar("rechaza un repositorio que no es una dirección y un resumen largo",
  errores.some((e) => e.includes("skill.repo")) && errores.some((e) => e.includes("ficha.resumen")));
comprobar("una definición que no es objeto no valida", !validarDefinicion(null).ok && !validarDefinicion([]).ok);

const vieja = validarDefinicion({ proposito: "algo", etapas: [{ orden: 1, nombre: "Hacerlo" }], ficha: { resumen: "Algo." } });
comprobar("una definición vieja, con etapas, se sigue leyendo", vieja.ok && vieja.definicion.requisitos.length === 0 && vieja.definicion.ficha?.resumen === "Algo.");

comprobar("la clave sale del nombre", claveDeNombre("Carrusel P3 · estilo Concepto") === "carrusel-p3-estilo-concepto");
comprobar("la clave declarada manda sobre el nombre", familiaDe({ nombre: "Otra cosa v4", definicion: { proceso: "post-valentina" } }) === "post-valentina");
comprobar("los registros viejos con « vN» comparten clave",
  familiaDe({ nombre: "Carrusel P3 v2", definicion: {} }) === familiaDe({ nombre: "Carrusel P3 v1", definicion: {} }));
comprobar("el nombre se muestra sin « vN»", nombreDeFamilia("Carrusel P3 v12") === "Carrusel P3");
comprobar("el resumen corto es la primera oración", resumenCorto("Una cosa. Otra cosa.") === "Una cosa.");

// --- La iteración ------------------------------------------------------------------------
const receta = { pasos: ["Investigar", "Renderizar"], herramientas: ["carousel-builder"], modelo: "Claude", decisiones: [] };
const completa = {
  titulo: "Federer y On",
  carpeta: "https://www.dropbox.com/home/Clientes/www.p3planeta.com/p3-negocios/piezas/2026-11-11-federer-on",
  archivos: ["slide-01.jpg", "caption.txt"],
  datos: { deportista: "Federer y On", fuentes: ["https://a", "https://b"] },
  receta,
  conversacion: "claude://claude.ai/epitaxy/local_1",
};
const dv = valida.ok ? valida.definicion : {};
comprobar("una iteración completa se registra", faltasDeIteracion(dv, completa).length === 0, JSON.stringify(faltasDeIteracion(dv, completa)));

const sinDropbox = faltasDeIteracion(dv, { ...completa, carpeta: "C:/Users/x/Desktop", archivos: [] });
comprobar("sin carpeta de Dropbox y sin archivos no se registra",
  sinDropbox.some((f) => f.startsWith("carpeta")) && sinDropbox.some((f) => f.startsWith("archivos")), JSON.stringify(sinDropbox));
comprobar("la carpeta puede ser la ruta dentro de Dropbox", esCarpetaDeDropbox("/Clientes/x/piezas/2026-11-11-algo"));
comprobar("o el enlace web de Dropbox", esCarpetaDeDropbox("https://www.dropbox.com/scl/fo/abc"));
comprobar("y no otra cosa", !esCarpetaDeDropbox("https://drive.google.com/x") && !esCarpetaDeDropbox("/Clientes/../x") && !esCarpetaDeDropbox("http://www.dropbox.com/x") && !esCarpetaDeDropbox(""));

const sinDatos = faltasDeIteracion(dv, { ...completa, datos: { deportista: " " } });
comprobar("sin los datos que pide el proceso no se registra, y dice cuáles",
  sinDatos.some((f) => f.startsWith("datos.deportista")) && sinDatos.some((f) => f.startsWith("datos.fuentes")), JSON.stringify(sinDatos));
comprobar("lo opcional no se exige", !sinDatos.some((f) => f.startsWith("datos.nota")));
comprobar("una lista vacía cuenta como que falta", datosFaltantes([{ clave: "fuentes", descripcion: "x" }], { fuentes: [] }).length === 1);

comprobar("sin receta completa no se registra", faltasDeIteracion(dv, { ...completa, receta: { pasos: [] } }).some((f) => f.startsWith("receta.pasos")));
comprobar("la receta pide pasos, herramientas, modelo y decisiones", faltasDeReceta({}).length === 4);
comprobar("una reproducción que no salió igual dice qué faltó",
  faltasDeIteracion(dv, { ...completa, reproduccion: { salio_igual: false } }).some((f) => f.includes("que_falto"))
  && faltasDeIteracion(dv, { ...completa, reproduccion: { salio_igual: true } }).length === 0);
comprobar("la conversación acepta enlaces web y de la app de Claude",
  esEnlaceDeConversacion("https://claude.ai/share/x") && esEnlaceDeConversacion("claude://claude.ai/epitaxy/local_1"));
comprobar("y no otros esquemas", !esEnlaceDeConversacion("javascript:alert(1)") && !esEnlaceDeConversacion("la de ayer"));
comprobar("la skill sale del campo, de la receta o de una herramienta «skill …»",
  skillDeIteracion({ skill: "x @ abc" }) === "x @ abc"
  && skillDeIteracion({ receta: { skill: "y @ def" } }) === "y @ def"
  && skillDeIteracion({ receta: { herramientas: ["skill z v1"] } }) === "z v1"
  && skillDeIteracion({ receta: {} }) === null);

// --- La guía -----------------------------------------------------------------------------
const guia = guiaDeProceso({
  nombre: "Carrusel P3 Negocios",
  definicion: dv,
  recientes: [{ titulo: "Messi y sus hoteles", skill: "carrusel-p3-negocios @ f31eaf4", receta: { ...receta, prompts: ["Escribí 9 láminas,\nuna por idea"] }, carpeta: "/Clientes/x" }],
});
comprobar("la guía empieza por comprobar la máquina, con cómo y qué hacer si falta",
  guia.indexOf("Antes de empezar") < guia.indexOf("Cómo se hace") && guia.includes("python -c \"import PIL\"") && guia.includes("pip install pillow"));
comprobar("la guía dice que no se reemplaza lo que falta", guia.includes("no lo reemplaces"));
comprobar("la guía dice dónde guardar y que se comprueba en Dropbox antes de registrar",
  guia.includes(definicion.carpeta) && guia.includes("conector de Dropbox"));
comprobar("la guía lista lo que hay que registrar, con lo opcional marcado",
  guia.includes("deportista: el deportista y el negocio") && guia.includes("nota: algo para la próxima (opcional)"));
comprobar("la guía manda a la skill y a anotar su commit", guia.includes("Seguí la skill carrusel-p3-negocios") && guia.includes("commit"));
comprobar("la guía trae las últimas veces, con los prompts tal cual", guia.includes("Messi y sus hoteles") && guia.includes("> Escribí 9 láminas,") && guia.includes("> una por idea"));
comprobar("la guía no habla de etapas ni de versiones del proceso", !/etapa|versión vigente|tomar_caso|cerrar_etapa/i.test(guia));

const guiaSinNada = guiaDeProceso({ nombre: "Algo", definicion: { requisitos: [], registro: [] }, recientes: [] });
comprobar("sin requisitos ni skill, la guía lo dice y no inventa", guiaSinNada.includes("no declara requisitos") && guiaSinNada.includes("receta de las últimas veces"));

// --- Lo que escribe una persona ----------------------------------------------------------
const leidos = requisitosDeTexto("carousel-builder | skill | existe la carpeta | clonar prc-skills\nPillow | librería | python -c \"import PIL\"\n\nmal escrito");
comprobar("los requisitos se leen de a una línea, con «librería» con tilde",
  leidos.requisitos.length === 2 && leidos.requisitos[1].tipo === "libreria" && !leidos.requisitos[1].instalar, JSON.stringify(leidos));
comprobar("una línea que no se entiende se informa, no se pierde", leidos.errores.length === 1 && leidos.errores[0].startsWith("Línea 4"));
comprobar("y vuelven a texto igual", requisitosDeTexto(requisitosATexto(leidos.requisitos)).requisitos.length === 2
  && requisitosATexto(leidos.requisitos).split("\n")[1] === "Pillow | libreria | python -c \"import PIL\"");
const registro = registroDeTexto("deportista | el deportista\nnota | algo | opcional\nCon Espacio | x");
comprobar("el registro se lee de a una línea, con lo opcional", registro.registro.length === 2 && registro.registro[1].requerido === false && registro.errores.length === 1);
comprobar("y vuelve a texto igual", registroATexto(registro.registro) === "deportista | el deportista\nnota | algo | opcional");

// Un proceso completo: lo mínimo para que otra persona lo repita.
const completo = {
  ficha: { resumen: "Un carrusel", entrada: "Un deportista", entrega: "9 láminas", skill: { nombre: "carrusel-p3-negocios", repo: "https://github.com/pcanete/prc-skills" } },
  carpeta: "/Clientes/www.p3planeta.com/p3-negocios/piezas/",
  requisitos: [{ nombre: "Node", tipo: "programa", verificar: "node --version" }],
  registro: [{ clave: "deportista", descripcion: "el deportista" }],
};
comprobar("un proceso completo no tiene faltas", faltasDeFicha(completo).length === 0, faltasDeFicha(completo).join("; "));
const vacio = faltasDeFicha({ requisitos: [], registro: [] });
comprobar("a un proceso vacío le faltan siete cosas", vacio.length === 7, vacio.join("; "));
comprobar("sin requisitos ni registro, faltan los dos",
  faltasDeFicha({ ...completo, requisitos: [], registro: [] }).some((f) => f.includes("requisito")) && faltasDeFicha({ ...completo, registro: [] }).some((f) => f.includes("registro")));
const sinRepo = faltasDeFicha({ ...completo, ficha: { ...completo.ficha, skill: { nombre: "x" } } });
comprobar("una skill sin repositorio falta, y lo dice", sinRepo.length === 1 && sinRepo[0].includes("repositorio"), sinRepo.join("; "));
comprobar("sin skill, el método escrito alcanza", faltasDeFicha({ ...completo, ficha: { ...completo.ficha, skill: undefined }, metodo: "1. Hacer esto" }).length === 0);
comprobar("sin skill ni método, falta uno de los dos", faltasDeFicha({ ...completo, ficha: { ...completo.ficha, skill: undefined } }).length === 1);
comprobar("una carpeta que no es de Dropbox no cuenta", faltasDeFicha({ ...completo, carpeta: "C:/Users/x/Escritorio" }).some((f) => f.includes("Dropbox")));

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nProcesos e iteraciones: todas las comprobaciones pasaron.");
