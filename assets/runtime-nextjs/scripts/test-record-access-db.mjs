/**
 * Matriz de alcance por registro contra PostgreSQL real.
 *
 * La otra prueba (`test-record-access.mjs`) lee el código fuente y comprueba que cada
 * camino aplique alcance. Eso atrapa omisiones, que es su trabajo, pero no prueba nada
 * sobre el comportamiento: que `getRecord` mencione `recordAccessCondition` no demuestra
 * que Ana no vea los registros de Bruno.
 *
 * Esta prueba responde esa pregunta y sólo esa. Siembra dos personas del mismo rol
 * acotado, un registro de cada una, y ejerce **el repositorio real** —importado, no
 * reescrito— con la identidad de una y de la otra. Una prueba que reimplementa lo que
 * dice verificar confirma su propia reimplementación.
 *
 * Requiere una base descartable: crea filas y las borra al terminar. Si la aplicación no
 * declara ninguna entidad con `record_access`, no hay nada que probar y termina bien: es
 * una función opcional, no una que falte.
 */
import { randomUUID } from "node:crypto";
import { effectiveRecordScope } from "@/lib/record-access";
import { runtimeSpec } from "@/lib/spec";
import { getPool, sql } from "@/lib/db";
import {
  countRecords,
  deleteRecord,
  getRecord,
  insertRecord,
  listRecords,
  relationshipOptions,
  updateRecord,
} from "@/lib/repository";

let fallos = 0;
function comprobar(nombre, condicion, detalle = "") {
  if (condicion) {
    console.log(`  ok  ${nombre}`);
  } else {
    fallos += 1;
    console.error(`  FALLA  ${nombre}${detalle ? ` -- ${detalle}` : ""}`);
  }
}

/**
 * Hay dos formas legítimas de rechazar, y la diferencia es de diseño.
 *
 * Cuando el registro es de otra persona, el sistema no puede decir que existe: responde
 * `RecordOutOfScopeError`, indistinguible de "no está". Ahí se exige el código, porque un
 * mensaje más explicativo sería una filtración.
 *
 * Cuando el rechazo es sobre lo que quien escribe ya sabe —intentar crear a nombre de
 * otro, o pasarle un registro propio a otra persona— no hay nada que ocultar y el mensaje
 * debe explicar. Exigir el mismo código en los cuatro casos empeoraría dos mensajes para
 * que la prueba quedara más prolija.
 */
async function esperaRechazo(nombre, accion, { ocultando = false } = {}) {
  try {
    await accion();
    fallos += 1;
    console.error(`  FALLA  ${nombre} -- la operación se completó y debía ser rechazada`);
  } catch (error) {
    if (!ocultando) {
      comprobar(nombre, true);
      return;
    }
    comprobar(nombre, error?.code === "record_out_of_scope",
      `rechazó con "${error?.message ?? error}" en vez de ocultar la existencia del registro`);
  }
}

const entidad = runtimeSpec.entities.find((candidata) => candidata.record_access);
if (!entidad) {
  console.log("Ninguna entidad declara record_access: no hay comportamiento que probar.");
  await getPool().end();
  process.exit(0);
}

const politica = entidad.record_access;
const rolAcotado = Object.entries(politica.roles).find(([, alcance]) => alcance === "own")?.[0];
const rolTotal = Object.entries(politica.roles).find(([, alcance]) => alcance === "all")?.[0];
if (!rolAcotado || !rolTotal) {
  console.log(`La política de ${entidad.key} no tiene un rol acotado y uno total: nada que contrastar.`);
  await getPool().end();
  process.exit(0);
}

console.log(`Entidad bajo prueba: ${entidad.key} (dueño: ${politica.owner_field})`);
console.log(`Roles: ${rolAcotado} ve lo propio, ${rolTotal} ve todo\n`);

const marca = `alcance-${Date.now()}`;
const sembrados = { usuarios: [], registros: [] };

async function sembrarPersona(nombre, roleKey) {
  const id = randomUUID();
  // `email` lleva un CHECK de minúsculas y sin espacios; `display_name`, uno de largo.
  await sql(
    `INSERT INTO app_user ("id", "email", "display_name", "role_key", "active", "auth_subject")
     VALUES ($1, $2, $3, $4, TRUE, $5)`,
    [id, `${nombre}-${marca}@prueba.local`.toLowerCase(), `${nombre} ${marca}`, roleKey, `prueba:${id}`],
  );
  sembrados.usuarios.push(id);
  return { id, roleKey };
}

/** Valores mínimos para que la fila pase los NOT NULL y los CHECK de la entidad. */
function valoresMinimos(sufijo, deEntidad = entidad) {
  const valores = {};
  // El dueño lo fija el repositorio; y es el de *esta* entidad, no el de la principal.
  const campoDueno = deEntidad.record_access?.owner_field;
  for (const campo of deEntidad.fields) {
    if (!campo.required || campo.key === campoDueno) continue;
    switch (campo.type) {
      case "integer": valores[campo.key] = 1; break;
      case "decimal": valores[campo.key] = 1.5; break;
      case "boolean": valores[campo.key] = true; break;
      case "date": valores[campo.key] = "2026-01-01"; break;
      case "datetime": valores[campo.key] = new Date().toISOString(); break;
      case "email": valores[campo.key] = `x-${marca}@prueba.local`; break;
      case "url": valores[campo.key] = "https://ejemplo.test/x"; break;
      case "enum": valores[campo.key] = campo.options?.[0]?.key; break;
      case "json": case "file": valores[campo.key] = { prueba: marca }; break;
      default: valores[campo.key] = `${marca} ${sufijo}`;
    }
  }
  return valores;
}

/**
 * Una entidad puede exigir relaciones: `work_order` no existe sin su equipo. Se siembran
 * con alcance total para que el prerrequisito nunca sea el que falla — lo que se está
 * probando es el alcance, no la capacidad de armar una fila válida.
 */
async function sembrarPrerequisitos(deEntidad, comoQuienVeTodo, profundidad = 0) {
  const referencias = {};
  if (profundidad > 2) return referencias;
  for (const relacion of deEntidad.relationships ?? []) {
    if (relacion.type !== "belongs_to" || !relacion.required) continue;
    const destino = runtimeSpec.entities.find((candidata) => candidata.key === relacion.target);
    if (!destino) continue;
    const anidadas = await sembrarPrerequisitos(destino, comoQuienVeTodo, profundidad + 1);
    const id = await insertRecord(
      destino.key,
      { ...valoresMinimos(`req-${destino.key}`, destino), ...anidadas },
      undefined,
      comoQuienVeTodo,
    );
    sembrados.registros.unshift({ entityKey: destino.key, id });
    referencias[`${relacion.key}_id`] = id;
  }
  return referencias;
}

async function limpiar() {
  // En orden inverso al sembrado: lo que depende de otra fila se borra primero.
  for (const { entityKey, id } of [...sembrados.registros].reverse()) {
    await sql(`DELETE FROM "${entityKey}" WHERE "id" = $1`, [id]).catch(() => {});
  }
  if (sembrados.usuarios.length) {
    await sql(`DELETE FROM app_user WHERE "id" = ANY($1::uuid[])`, [sembrados.usuarios]).catch(() => {});
  }
}

try {
  const ana = await sembrarPersona("ana", rolAcotado);
  const bruno = await sembrarPersona("bruno", rolAcotado);
  const dora = await sembrarPersona("dora", rolTotal);

  const deAna = { userId: ana.id, roleKeys: [rolAcotado] };
  const deBruno = { userId: bruno.id, roleKeys: [rolAcotado] };
  const deDora = { userId: dora.id, roleKeys: [rolTotal] };

  comprobar("el alcance efectivo distingue los dos roles",
    effectiveRecordScope(entidad, deAna) === "own" && effectiveRecordScope(entidad, deDora) === "all");

  console.log("\nCrear");
  const requisitos = await sembrarPrerequisitos(entidad, deDora);
  const idDeAna = await insertRecord(entidad.key, { ...valoresMinimos("de-ana"), ...requisitos }, undefined, deAna);
  sembrados.registros.push({ entityKey: entidad.key, id: idDeAna });
  const filaDeAna = await getRecord(entidad.key, idDeAna, undefined, false, deDora);
  comprobar("el registro nace a nombre de quien lo crea",
    String(filaDeAna?.[politica.owner_field]) === ana.id,
    `quedó a nombre de ${filaDeAna?.[politica.owner_field]}`);

  const idDeBruno = await insertRecord(entidad.key, { ...valoresMinimos("de-bruno"), ...requisitos }, undefined, deBruno);
  sembrados.registros.push({ entityKey: entidad.key, id: idDeBruno });

  await esperaRechazo("crear a nombre de otra persona se rechaza", () =>
    insertRecord(entidad.key, { ...valoresMinimos("robado"), ...requisitos, [politica.owner_field]: bruno.id }, undefined, deAna));

  console.log("\nLeer");
  const leidoPropio = await getRecord(entidad.key, idDeAna, undefined, false, deAna);
  comprobar("cada quien lee lo propio", Boolean(leidoPropio));
  const leidoAjeno = await getRecord(entidad.key, idDeBruno, undefined, false, deAna);
  comprobar("un registro ajeno responde como inexistente", leidoAjeno === null || leidoAjeno === undefined,
    "devolvió la fila de otra persona");
  comprobar("quien ve todo lee ambos",
    Boolean(await getRecord(entidad.key, idDeAna, undefined, false, deDora))
    && Boolean(await getRecord(entidad.key, idDeBruno, undefined, false, deDora)));

  console.log("\nListar y contar");
  const listaDeAna = await listRecords(entidad.key, { access: deAna, limit: 200 });
  const idsDeAna = new Set(listaDeAna.map((fila) => String(fila.id)));
  comprobar("el listado incluye lo propio", idsDeAna.has(idDeAna));
  comprobar("el listado excluye lo ajeno", !idsDeAna.has(idDeBruno), "el listado filtró de menos");
  const listaDeDora = await listRecords(entidad.key, { access: deDora, limit: 200 });
  const idsDeDora = new Set(listaDeDora.map((fila) => String(fila.id)));
  comprobar("quien ve todo los ve a los dos", idsDeDora.has(idDeAna) && idsDeDora.has(idDeBruno));
  const totalAna = await countRecords(entidad.key, deAna);
  const totalDora = await countRecords(entidad.key, deDora);
  comprobar("el conteo también filtra", totalAna < totalDora, `${totalAna} vs ${totalDora}`);

  console.log("\nModificar y borrar");
  const campoTexto = entidad.fields.find((campo) => campo.type === "text" && campo.key !== politica.owner_field);
  if (campoTexto) {
    await updateRecord(entidad.key, idDeAna, { [campoTexto.key]: `${marca} editado` }, undefined, deAna);
    const releido = await getRecord(entidad.key, idDeAna, undefined, false, deAna);
    comprobar("modificar lo propio funciona", String(releido?.[campoTexto.key]).endsWith("editado"));
    await esperaRechazo("modificar lo ajeno se rechaza", () =>
      updateRecord(entidad.key, idDeBruno, { [campoTexto.key]: "intruso" }, undefined, deAna),
      { ocultando: true });
    await esperaRechazo("transferir un registro a otra persona se rechaza", () =>
      updateRecord(entidad.key, idDeAna, { [politica.owner_field]: bruno.id }, undefined, deAna));
  }
  await esperaRechazo("borrar lo ajeno se rechaza", () =>
    deleteRecord(entidad.key, idDeBruno, undefined, deAna), { ocultando: true });
  const sigueVivo = await getRecord(entidad.key, idDeBruno, undefined, false, deDora);
  comprobar("el registro ajeno sobrevivió al intento", Boolean(sigueVivo));

  console.log("\nRelaciones");
  // Sólo `belongs_to`: es el único tipo que se guarda como columna en el origen y el
  // único que `relationshipOptions` ofrece. Buscar sobre `has_many` daría un falso
  // aprobado — la asignación no fallaría porque la columna directamente no existe.
  const apuntaAAcotada = (candidata) => (candidata.relationships ?? []).find((relacion) =>
    relacion.type === "belongs_to"
    && runtimeSpec.entities.find((e) => e.key === relacion.target)?.record_access);
  const conRelacionAcotada = runtimeSpec.entities.find((candidata) => apuntaAAcotada(candidata));
  if (conRelacionAcotada) {
    const relacion = apuntaAAcotada(conRelacionAcotada);
    const destino = runtimeSpec.entities.find((e) => e.key === relacion.target);
    // El registro ajeno tiene que ser de la entidad *destino*: si la relación apunta a
    // otra tabla, el registro de Bruno que ya existe no sirve para probar nada.
    let ajeno = idDeBruno;
    if (destino.key !== entidad.key) {
      const requisitosDeDestino = await sembrarPrerequisitos(destino, deDora);
      ajeno = await insertRecord(
        destino.key,
        { ...valoresMinimos("ajeno", destino), ...requisitosDeDestino, [destino.record_access.owner_field]: bruno.id },
        undefined,
        deDora,
      );
      sembrados.registros.push({ entityKey: destino.key, id: ajeno });
    }
    const opciones = await relationshipOptions(conRelacionAcotada, deAna);
    const ofrecidos = new Set((opciones[relacion.key] ?? []).map((opcion) => String(opcion.id)));
    comprobar(`el desplegable de ${relacion.key} no ofrece registros ajenos`, !ofrecidos.has(ajeno),
      "ofrecía un registro fuera de alcance");
    const requisitosDeOrigen = await sembrarPrerequisitos(conRelacionAcotada, deDora);
    await esperaRechazo("asignar una relación fuera de alcance se rechaza", () =>
      insertRecord(
        conRelacionAcotada.key,
        {
          ...valoresMinimos("con-relacion", conRelacionAcotada),
          ...requisitosDeOrigen,
          [`${relacion.key}_id`]: ajeno,
        },
        undefined,
        deAna,
      ), { ocultando: true });
  } else {
    // No es un aprobado: es que esta aplicación no tiene dónde ejercerlo. Se dice, para
    // que nadie lea el verde de arriba como cobertura de algo que no se probó.
    console.log("  --  sin cobertura: ninguna entidad tiene un belongs_to hacia una entidad con política");
  }
} finally {
  await limpiar();
  await getPool().end();
}

console.log(fallos === 0 ? "\nComportamiento del alcance verificado." : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
