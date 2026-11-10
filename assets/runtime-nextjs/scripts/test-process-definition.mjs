/**
 * Pruebas de la definición de procesos: validación, pedido, cierre, destino y guía.
 *
 * Importa el módulo real (`platform/processes/definition.ts`, sin dependencias) con
 * --experimental-strip-types: una prueba que pasa habla del código que corre.
 *
 * Lo que tiene que valer:
 *   - una definición mal escrita se rechaza diciendo dónde, antes de que alguien trabaje;
 *   - un pedido incompleto no abre caso, y lo opcional no se exige;
 *   - una etapa no cierra sin enlace, salidas, receta y evidencia de cada criterio;
 *   - lo que juzga quien revisa no se le exige a quien cierra;
 *   - la guía dice qué herramienta usar y qué hacer si no está, y no muestra lo que la
 *     etapa no declara ver;
 *   - una etapa con requisitos sólo la toma quien declara tenerlos;
 *   - una etapa que pide elegir deja al menos dos opciones, y la elegida queda a la vista
 *     de las etapas siguientes;
 *   - una receta registrada forma un proceso válido, y su guía trae los prompts tal cual.
 */
import {
  claveDeNombre,
  componerGuia,
  definicionDesdeReceta,
  faltasDeReceta,
  familiaDe,
  guiaDeProceso,
  nombreDeFamilia,
  destinoTrasAprobar,
  destinoTrasCerrar,
  entradasFaltantes,
  herramientasQueFaltan,
  opcionesParaElegir,
  puedeRevisar,
  puedeTomar,
  validarCierre,
  validarDefinicion,
  visiblesParaEtapa,
} from "../src/platform/processes/definition.ts";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) console.log(`  ok  ${nombre}`);
  else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

const roles = ["director", "socio", "colaborador"];
const definicion = {
  proposito: "Liquidar el IVA mensual de un cliente.",
  donde_vive_el_resultado: "La carpeta del cliente en el Dropbox del estudio.",
  pedido: {
    entradas: {
      periodo: "mes y año, por ejemplo 2026-10",
      carpeta: "enlace a la carpeta con las facturas del período",
      notas: "opcional: algo que el contador tenga que saber",
    },
  },
  etapas: [
    {
      orden: 1,
      nombre: "Control de insumos",
      ejecutor: "cualquiera",
      grupo: ["colaborador", "socio", "director"],
      entradas_visibles: ["insumos"],
      instrucciones: "Revisar que la carpeta tenga facturas de venta, de compra y extractos del período.",
      criterios: [{ tipo: "mecanico", texto: "hay al menos un archivo en cada subcarpeta" }],
      salidas: { control: "lista de lo que está y lo que falta" },
      revision: "ninguna",
    },
    {
      orden: 2,
      nombre: "Liquidación",
      ejecutor: "cualquiera",
      grupo: ["colaborador"],
      entradas_visibles: ["insumos", "control"],
      instrucciones: "Armar la liquidación con la planilla del estudio.",
      pasos: ["Abrir la planilla", "Cargar ventas", "Cargar compras"],
      errores_frecuentes: ["Tomar facturas de otro período"],
      herramientas: [{ nombre: "liquidador-iva", tipo: "skill", uso: "arma la planilla" }],
      criterios: [
        { tipo: "mecanico", texto: "débito y crédito cuadran con las facturas" },
        { tipo: "juicio", texto: "las percepciones están bien imputadas" },
      ],
      salidas: { liquidacion: "enlace a la planilla" },
      revision: "humana",
      revisores: ["socio", "director"],
    },
  ],
};

console.log("\n1. Validación de la definición");
const valida = validarDefinicion(definicion, roles);
comprobar("una definición correcta valida", valida.ok, JSON.stringify(valida.errores ?? []));

const conErrores = validarDefinicion({
  etapas: [
    { orden: 1, nombre: "A", ejecutor: "robot", grupo: ["gerente"], instrucciones: "", revision: "quizás" },
    { orden: 3, nombre: "B", ejecutor: "humano", grupo: ["socio"], instrucciones: "x", revision: "ninguna", entradas_visibles: ["fantasma"] },
  ],
}, roles);
const errores = conErrores.ok ? [] : conErrores.errores;
comprobar("rechaza un ejecutor inválido", errores.some((e) => e.includes("ejecutor")));
comprobar("rechaza un rol que no existe", errores.some((e) => e.includes("«gerente»")));
comprobar("rechaza una etapa sin instrucciones", errores.some((e) => e.includes("no tiene instrucciones")));
comprobar("rechaza saltos de numeración", errores.some((e) => e.includes("orden 3")));
comprobar("rechaza ver algo que nadie deja", errores.some((e) => e.includes("«fantasma»")));
comprobar("rechaza lo que no es objeto", !validarDefinicion("hola").ok && !validarDefinicion({ etapas: [] }).ok);

console.log("\n2. Pedido");
const def = valida.definicion;
const faltan = entradasFaltantes(def, { periodo: "2026-10" });
comprobar("falta lo requerido", faltan.length === 1 && faltan[0].clave === "carpeta", JSON.stringify(faltan));
comprobar("lo opcional no se exige", !faltan.some((f) => f.clave === "notas"));
comprobar("un texto en blanco cuenta como vacío", entradasFaltantes(def, { periodo: "  ", carpeta: "x" }).length === 1);
comprobar("completo no falta nada", entradasFaltantes(def, { periodo: "2026-10", carpeta: "https://dropbox/x" }).length === 0);

console.log("\n3. Cierre");
const [control, liquidacion] = def.etapas;
const recetaBuena = { pasos: ["Abrí la carpeta"], herramientas: [], modelo: "Claude", decisiones: [] };
const vacio = validarCierre(control, { enlace: "", salidas: {}, receta: {}, criterios: [] });
comprobar("sin nada, dice todo lo que falta", vacio.length >= 6, vacio.join(" | "));
comprobar("exige el enlace", vacio.some((f) => f.startsWith("enlace")));
comprobar("exige las salidas de la etapa", vacio.some((f) => f.startsWith("salidas.control")));
comprobar("exige la receta", vacio.some((f) => f.startsWith("receta.pasos")) && vacio.some((f) => f.startsWith("receta.modelo")));
comprobar("rechaza un enlace que no es web", validarCierre(control, {
  enlace: "C:\\Users\\yo\\liquidacion.xlsx", salidas: { control: "ok" }, receta: recetaBuena,
  criterios: [{ criterio: 1, cumplido: true, evidencia: "3 subcarpetas con archivos" }],
}).some((f) => f.startsWith("enlace")));
const sinEvidencia = validarCierre(control, {
  enlace: "https://dropbox.com/x", salidas: { control: "ok" }, receta: recetaBuena, criterios: [{ criterio: 1, cumplido: true }],
});
comprobar("un criterio sin evidencia no cierra", sinEvidencia.some((f) => f.includes("evidencia")), sinEvidencia.join(" | "));
comprobar("un criterio no cumplido no cierra", validarCierre(control, {
  enlace: "https://dropbox.com/x", salidas: { control: "ok" }, receta: recetaBuena,
  criterios: [{ criterio: 1, cumplido: false, evidencia: "falta compras" }],
}).some((f) => f.includes("no está cumplido")));
comprobar("se puede responder un criterio por su texto", validarCierre(control, {
  enlace: "https://dropbox.com/x", salidas: { control: "ok" }, receta: recetaBuena,
  criterios: [{ criterio: "hay al menos un archivo en cada subcarpeta", cumplido: true, evidencia: "visto" }],
}).length === 0);
const conRevision = validarCierre(liquidacion, {
  enlace: "https://dropbox.com/liq", salidas: { liquidacion: "https://dropbox.com/liq" }, receta: recetaBuena,
  criterios: [{ criterio: 1, cumplido: true, evidencia: "cuadra a $0" }],
});
comprobar("el juicio lo deja para quien revisa", conRevision.length === 0, conRevision.join(" | "));

console.log("\n4. Destino, cola y revisión");
comprobar("sin revisión pasa a la siguiente", JSON.stringify(destinoTrasCerrar(def, control)) === JSON.stringify({ tipo: "siguiente", orden: 2 }));
comprobar("con revisión humana queda en revisión", destinoTrasCerrar(def, liquidacion).tipo === "revision");
comprobar("aprobar la última entrega", destinoTrasAprobar(def, liquidacion).tipo === "entrega");
comprobar("toma quien está en el grupo", puedeTomar(liquidacion, ["colaborador"]));
comprobar("no toma quien no está", !puedeTomar(liquidacion, ["socio"]));
comprobar("un agente queda acotado por su responsable", !puedeTomar(liquidacion, ["colaborador", "socio"]));
comprobar("revisan los revisores declarados", puedeRevisar(liquidacion, ["socio"], ["director"]));
comprobar("sin revisores declarados revisa quien administra", puedeRevisar(control, ["director"], ["director"]) && !puedeRevisar(control, ["socio"], ["director"]));

console.log("\n5. Guía");
const acumulado = { insumos: { periodo: "2026-10" }, control: "todo está", secreto: "no mostrar" };
const visibles = visiblesParaEtapa(liquidacion, acumulado);
comprobar("muestra lo que la etapa declara", "control" in visibles && "insumos" in visibles);
comprobar("no muestra lo que no declara", !("secreto" in visibles));
const guia = componerGuia({
  titulo: "IVA octubre — Cliente X",
  proceso: "IVA mensual v1",
  definicion: def,
  etapa: liquidacion,
  estado: "tomada",
  visibles,
  devolucion: "Faltó una percepción de ARBA",
});
comprobar("nombra la etapa y su posición", guia.includes("Etapa 2 de 2") && guia.includes("Liquidación"));
comprobar("nombra la herramienta y qué hacer si falta", guia.includes("liquidador-iva") && guia.includes("esperar_caso"));
comprobar("incluye pasos y errores frecuentes", guia.includes("1. Abrir la planilla") && guia.includes("otro período"));
comprobar("muestra el motivo de la devolución", guia.includes("Faltó una percepción"));
comprobar("dice quién juzga cada criterio", guia.includes("lo verificás vos") && guia.includes("lo juzga quien revisa"));
comprobar("explica cómo cerrar con las salidas", guia.includes("cerrar_etapa") && guia.includes("«liquidacion»"));
comprobar("no filtra lo que no declara", !guia.includes("no mostrar"));
const guiaHumana = componerGuia({
  titulo: "x", proceso: "y", definicion: def, estado: "tomada", visibles: {},
  etapa: { ...control, ejecutor: "humano" },
});
comprobar("en una etapa humana le dice a la IA que no decida", guiaHumana.includes("No decidas por ella"));

// --- Requisitos de máquina y elección ---------------------------------------------------
const conEleccion = {
  etapas: [
    {
      orden: 1, nombre: "Temas", ejecutor: "agente", grupo: ["colaborador"], instrucciones: "Proponer tres temas.",
      salidas: { temas: "las opciones" }, revision: "humana", eleccion: { opciones: "temas", guarda: "tema_elegido" },
    },
    {
      orden: 2, nombre: "Video", ejecutor: "agente", grupo: ["colaborador"], instrucciones: "Editar el video.",
      entradas_visibles: ["tema_elegido"], requiere: ["hyperframes"], salidas: { video: "el render" }, revision: "humana",
    },
  ],
};
const eleccionValida = validarDefinicion(conEleccion, roles);
comprobar("una etapa con eleccion y otra con requiere validan, y la elegida se puede ver después",
  eleccionValida.ok, JSON.stringify(eleccionValida.errores ?? []));
const sinPersona = validarDefinicion({ etapas: [{ ...conEleccion.etapas[0], revision: "agente" }] }, roles);
comprobar("elegir sin revisión humana se rechaza", !sinPersona.ok && sinPersona.errores.some((e) => e.includes("revision humana")));
const opcionesAjenas = validarDefinicion({ etapas: [{ ...conEleccion.etapas[0], eleccion: { opciones: "otra", guarda: "x" } }] }, roles);
comprobar("las opciones tienen que ser una salida de la etapa", !opcionesAjenas.ok && opcionesAjenas.errores.some((e) => e.includes("«otra»")));
const requisitoRaro = validarDefinicion({ etapas: [{ ...conEleccion.etapas[1], orden: 1, entradas_visibles: [], requiere: ["Hyper Frames"] }] }, roles);
comprobar("un requisito con espacios o mayúsculas se rechaza", !requisitoRaro.ok && requisitoRaro.errores.some((e) => e.includes("requiere")));

const [temas, video] = eleccionValida.definicion.etapas;
comprobar("sin declarar nada, falta lo que pide la etapa", herramientasQueFaltan(video).join() === "hyperframes");
comprobar("declarándolo, no falta nada (sin importar mayúsculas)", herramientasQueFaltan(video, ["HyperFrames", "ffmpeg"]).length === 0);
comprobar("una etapa sin requisitos la toma cualquiera", herramientasQueFaltan(temas).length === 0);

const unaSola = validarCierre(temas, { enlace: "https://x.y", salidas: { temas: [{ titulo: "A" }] }, receta: recetaBuena, criterios: [] });
comprobar("una sola opción no alcanza para elegir", unaSola.some((f) => f.includes("al menos dos")), unaSola.join(" | "));
const dos = validarCierre(temas, { enlace: "https://x.y", salidas: { temas: [{ titulo: "A" }, { titulo: "B" }] }, receta: recetaBuena, criterios: [] });
comprobar("dos opciones cierran", dos.length === 0, dos.join(" | "));
comprobar("las opciones se leen del cierre", opcionesParaElegir(temas, { temas: ["a", "b"] }).length === 2);
comprobar("una etapa sin elección no tiene opciones", opcionesParaElegir(video, { video: "x" }) === null);

const guiaEleccion = componerGuia({ titulo: "x", proceso: "y", definicion: eleccionValida.definicion, estado: "tomada", visibles: {}, etapa: temas });
comprobar("la guía explica cómo dejar las opciones y dónde queda la elegida",
  guiaEleccion.includes("«temas»") && guiaEleccion.includes("«tema_elegido»") && guiaEleccion.includes("elige una"));
const guiaVideo = componerGuia({ titulo: "x", proceso: "y", definicion: eleccionValida.definicion, estado: "tomada", visibles: {}, etapa: video });
comprobar("la guía dice qué necesita la máquina", guiaVideo.includes("Qué necesita la máquina") && guiaVideo.includes("hyperframes"));

// --- Recetas registradas -----------------------------------------------------------------
comprobar("la clave de un nombre no tiene tildes ni signos", claveDeNombre("Carrusel P3 · Estilo Concepción") === "carrusel-p3-estilo-concepcion");
comprobar("la familia sale de la definición si la declara", familiaDe({ nombre: "Otra cosa v4", definicion: { proceso: "post-valentina" } }) === "post-valentina");
comprobar("si no la declara, sale del nombre sin la versión",
  familiaDe({ nombre: "Carrusel P3 v2", definicion: {} }) === familiaDe({ nombre: "Carrusel P3 v1", definicion: {} }));
comprobar("el nombre de la familia no lleva la versión", nombreDeFamilia("Carrusel P3 v12") === "Carrusel P3");

const recetaRegistrada = {
  pasos: ["Elegir la nota", "Escribir los textos de 6 slides", "Renderizar con carousel-builder"],
  prompts: ["Escribí 6 slides sobre esta nota,\nuno por idea"],
  herramientas: ["carousel-builder"],
  modelo: "Claude Opus",
  decisiones: ["6 slides y no 8: la nota no daba para más"],
  descartes: ["Fondo oscuro: no se leía en el teléfono"],
};
comprobar("una receta completa no tiene faltas", faltasDeReceta(recetaRegistrada).length === 0);
comprobar("una receta sin pasos ni modelo dice qué falta",
  faltasDeReceta({ herramientas: [], decisiones: [] }).some((f) => f.startsWith("receta.pasos"))
  && faltasDeReceta({ herramientas: [], decisiones: [] }).some((f) => f.startsWith("receta.modelo")));
comprobar("los prompts tienen que ser textos", faltasDeReceta({ ...recetaRegistrada, prompts: [3] }).some((f) => f.startsWith("receta.prompts")));

const nacida = definicionDesdeReceta({
  nombre: "Carrusel P3 · concepto + historia",
  proposito: "Un carrusel de P3 a partir de una nota.",
  receta: recetaRegistrada,
  roles: ["colaborador", "director"],
  revisores: ["director"],
});
const nacidaValida = validarDefinicion(nacida, roles);
comprobar("la receta forma un proceso válido de una etapa", nacidaValida.ok && nacida.etapas.length === 1, JSON.stringify(nacidaValida.errores ?? []));
comprobar("el proceso nacido declara su familia y que vino de un registro",
  nacida.proceso === "carrusel-p3-concepto-historia" && nacida.nacio_de_registro === true);
comprobar("los descartes quedan como errores frecuentes", nacida.etapas[0].errores_frecuentes?.[0]?.includes("Fondo oscuro"));

const guiaReceta = guiaDeProceso({
  nombre: "Carrusel P3 · concepto + historia",
  version: 1,
  definicion: nacida,
  recientes: [{ titulo: "La frustración de Russell", fecha: "2026-11-04", receta: recetaRegistrada, resultado: "https://x.y/z" }],
});
comprobar("la guía trae los prompts tal cual, también los de varias líneas",
  guiaReceta.includes("> Escribí 6 slides sobre esta nota,") && guiaReceta.includes("> uno por idea"));
comprobar("la guía trae los pasos y la última vez que salió bien",
  guiaReceta.includes("1. Elegir la nota") && guiaReceta.includes("La frustración de Russell") && guiaReceta.includes("https://x.y/z"));
comprobar("la guía dice cómo registrar la reproducción", guiaReceta.includes("registrar_iteracion") && guiaReceta.includes("reproducción"));

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nDefinición de procesos: todas las comprobaciones pasaron.");
