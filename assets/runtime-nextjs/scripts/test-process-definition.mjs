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
 *     etapa no declara ver.
 */
import {
  componerGuia,
  destinoTrasAprobar,
  destinoTrasCerrar,
  entradasFaltantes,
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

if (fallos) {
  console.error(`\n${fallos} comprobación(es) fallaron.`);
  process.exit(1);
}
console.log("\nDefinición de procesos: todas las comprobaciones pasaron.");
