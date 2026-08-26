import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentEntities, requireAgentPermission } from "@/platform/mcp/access";
import {
  assertRecordOwnershipChange,
  prepareRecordCreate,
  recordAccessForAgent,
} from "@/lib/record-access";
import { executeIdempotentMutation } from "@/platform/mcp/mutations";
import {
  finishAgentToolEvent,
  startAgentToolEvent,
  type AgentPrincipal,
} from "@/platform/mcp/store";
import {
  countFilteredRecords,
  deleteRecord,
  getRecord,
  insertRecord,
  listRecords,
  recordInputFromObject,
  updateRecord,
} from "@/lib/repository";
import { recordAuditEvent, type AuditAction } from "@/lib/audit";
import {
  deleteAttachmentsForRecord,
  getAttachmentContent,
  getAttachmentMetadata,
  listAttachments,
  resolveAttachmentPolicy,
} from "@/lib/attachments";
import { applyRules } from "@/lib/rules";
import { revalidateAfterWrite } from "@/lib/revalidation";
import { relationFields, requireEntity, runtimeSpec } from "@/lib/spec";
import {
  deleteSetting,
  getSetting,
  listSettings,
  setSetting,
  type ActorDeConfiguracion,
} from "@/platform/settings/store";
import { withTransaction } from "@/lib/db";
import { generatedCapabilities } from "@/generated/permissions";

const entityKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const settingNameSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/);
const filtersSchema = z.record(z.string(), z.string().max(500)).optional();
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const mutationValuesSchema = z.record(z.string(), z.unknown()).superRefine((value, context) => {
  if (Object.keys(value).length > 100) context.addIssue({ code: "custom", message: "La mutación supera 100 campos." });
  if (JSON.stringify(value).length > 65_536) context.addIssue({ code: "custom", message: "La mutación supera 64 KB." });
});

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error MCP inesperado.";
}

function safeSummary(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => {
      if (key === "values" && value && typeof value === "object") {
        const serializedValues = JSON.stringify(value);
        return [key, {
          fields: Object.keys(value as Record<string, unknown>).sort(),
          fingerprint: createHash("sha256").update(serializedValues).digest("hex"),
        }];
      }
      const serialized = JSON.stringify(value);
      return [key, serialized && serialized.length > 1_000 ? `${serialized.slice(0, 997)}...` : value];
    }),
  );
}

/**
 * Ejecuta una herramienta MCP dejando rastro de quién la usó.
 *
 * El valor devuelto se serializa a JSON, así que acá alcanza con un objeto: fijar su
 * forma exacta obligaría a que todas las ramas de una herramienta coincidan, y eso
 * choca justo con lo que el alcance por registro necesita — que "no existe" y "no es
 * tuyo" puedan responder distinto de un resultado con datos.
 */
async function traced(
  agent: AgentPrincipal,
  toolName: string,
  input: Record<string, unknown>,
  execute: (eventId: string) => Promise<{ value: Record<string, unknown>; resultCount?: number }>,
) {
  // La actividad por herramienta se registra contra la credencial que la ejecutó, así
  // que sólo aplica a agentes. Una persona que opera por MCP ya deja rastro donde
  // corresponde: en la auditoría, junto a lo que hace desde el panel.
  if (agent.kind === "user") {
    const executed = await execute("");
    return result(executed.value);
  }

  const event = await startAgentToolEvent({
    agentId: agent.id,
    toolName,
    entityKey: typeof input.entityKey === "string" ? input.entityKey : undefined,
    inputSummary: safeSummary(input),
  });
  try {
    const executed = await execute(event.id);
    await finishAgentToolEvent({
      ...event,
      status: "completed",
      resultCount: executed.resultCount,
    });
    return result(executed.value);
  } catch (error) {
    await finishAgentToolEvent({
      ...event,
      status: "failed",
      errorMessage: errorMessage(error),
    }).catch(() => undefined);
    throw error;
  }
}

function recordForAgent(entityKey: string, record: Record<string, unknown>) {
  const entity = requireEntity(entityKey);
  return Object.fromEntries([
    ["id", record.id],
    ...entity.fields.map((field) => [field.key, record[field.key]]),
    ...relationFields(entity).map((relationship) => [
      `${relationship.key}_id`,
      record[`${relationship.key}_id`],
    ]),
    ["created_at", record.created_at],
    ["updated_at", record.updated_at],
  ]);
}

export function createFactoryMcpServer(agent: AgentPrincipal) {
  const server = new McpServer({
    name: `${runtimeSpec.app.key}-factory`,
    version: "0.1.0",
  });

  server.registerTool(
    "list_entities",
    {
      description: "Lista las entidades que este agente puede consultar.",
      inputSchema: z.object({}),
    },
    async () => traced(agent, "list_entities", {}, async () => {
      const entities = agentEntities(agent).map((entity) => ({
        key: entity.key,
        label: entity.label,
        label_plural: entity.label_plural,
        description: entity.description,
        title_field: entity.title_field,
      }));
      return { value: { entities }, resultCount: entities.length };
    }),
  );

  server.registerTool(
    "describe_entity",
    {
      description: "Describe campos, relaciones y capacidades de una entidad.",
      inputSchema: z.object({ entityKey: entityKeySchema }),
    },
    async ({ entityKey }) => traced(agent, "describe_entity", { entityKey }, async () => {
      const entity = requireAgentPermission(agent, entityKey, "list");
      return {
        value: {
          entity: {
            key: entity.key,
            label: entity.label,
            label_plural: entity.label_plural,
            description: entity.description,
            title_field: entity.title_field,
            fields: entity.fields,
            // `writeAs` cierra la distancia entre descubrir y escribir: la AppSpec
            // llama `client` a la relación y la columna es `client_id`. Ambos nombres
            // se aceptan al escribir, y acá se declara cuál es cuál.
            relationships: (entity.relationships ?? []).map((relationship) => ({
              ...relationship,
              writeAs: relationship.type === "belongs_to" ? `${relationship.key}_id` : null,
              writable: relationship.type === "belongs_to",
            })),
            attachments: entity.attachments,
          },
        },
      };
    }),
  );

  // La configuración del sistema es una primitiva propia: pares clave/valor con
  // alcance global. Está fuera de la AppSpec a propósito --no es dominio-- así que la
  // capacidad no sale de la matriz de entidades sino del rol de quien opera.
  //
  // Pero la capacidad sola no alcanza. Sobre entidades siempre hicieron falta las dos
  // cosas -- el alcance de la credencial Y el permiso del rol -- y la configuración
  // quedó afuera: con sólo mirar el rol, un token de lectura emitido para un
  // administrador podía reescribir la configuración del sistema. Acá van juntas.
  const capacidadAdministrativa = generatedCapabilities
    ? (generatedCapabilities[agent.roleKey] ?? []).includes("manage_users")
    : false;
  const puedeLeerConfiguracion = agent.scopes.includes("settings:read");
  const puedeAdministrar = capacidadAdministrativa && agent.scopes.includes("settings:write");

  // El alcance por registro de esta credencial: para un agente sale de su responsable
  // humano, y queda acotado por el rol de esa persona.
  const alcanceDeRegistros = recordAccessForAgent(agent);

  /** El autor que corresponde a esta credencial, en la columna que le toca. */
  const actorDeConfiguracion: ActorDeConfiguracion = { kind: agent.kind, id: agent.id };

  /**
   * Deja el cambio de configuración en la misma auditoría que usa el panel, con la
   * identidad que corresponda: una persona en `actor_id`, un agente en `agent_id`.
   * La auditoría exige exactamente una de las dos, y acá se cumple por construcción.
   */
  async function registrarConfiguracion(
    client: Parameters<typeof recordAuditEvent>[0],
    evento: { eventId: string; action: AuditAction; changes: unknown },
  ) {
    await recordAuditEvent(client, {
      ...(agent.kind === "agent"
        ? { agentId: agent.id, agentEventId: evento.eventId || undefined }
        : { actorId: agent.id }),
      entityKey: "app_setting",
      recordId: null,
      action: evento.action,
      changes: evento.changes,
    });
  }

  function exigirLectura() {
    if (!puedeLeerConfiguracion) {
      throw new Error("La credencial no tiene alcance para leer la configuración del sistema (settings:read).");
    }
  }

  function exigirEscritura() {
    if (!capacidadAdministrativa) {
      throw new Error("El rol no tiene permiso para cambiar la configuración del sistema.");
    }
    if (!agent.scopes.includes("settings:write")) {
      throw new Error("La credencial no tiene alcance para cambiar la configuración del sistema (settings:write).");
    }
  }

  server.registerTool(
    "list_settings",
    {
      description:
        "Lista las opciones de configuración del sistema, opcionalmente acotadas a un espacio de nombres.",
      inputSchema: z.object({ namespace: settingNameSchema.optional() }),
    },
    async ({ namespace }) => traced(agent, "list_settings", { namespace }, async () => {
      exigirLectura();
      const settings = await listSettings(namespace);
      return { value: { namespace: namespace ?? null, settings }, resultCount: settings.length };
    }),
  );

  server.registerTool(
    "get_setting",
    {
      description: "Devuelve el valor de una opción de configuración, o null si no existe.",
      inputSchema: z.object({ namespace: settingNameSchema, key: settingNameSchema }),
    },
    async ({ namespace, key }) => traced(agent, "get_setting", { namespace, key }, async () => {
      exigirLectura();
      const setting = await getSetting(namespace, key);
      return { value: { namespace, key, found: Boolean(setting), setting }, resultCount: setting ? 1 : 0 };
    }),
  );

  server.registerTool(
    "set_setting",
    {
      description:
        "Crea o reemplaza una opción de configuración. El valor es JSON: admite escalares, objetos y listas. Es para configuración, no para datos de negocio.",
      inputSchema: z.object({
        namespace: settingNameSchema,
        key: settingNameSchema,
        value: z.unknown(),
      }),
    },
    async ({ namespace, key, value }) => traced(agent, "set_setting", { namespace, key }, async (eventId) => {
      exigirEscritura();
      // La misma operación desde el panel deja un registro de auditoría con su autor.
      // Por MCP no dejaba ninguno: la garantía no puede depender de por qué puerta se
      // entró.
      const setting = await withTransaction(async (client) => {
        const guardada = await setSetting(client, { namespace, key, value, actor: actorDeConfiguracion });
        await registrarConfiguracion(client, {
          eventId,
          action: "setting_save",
          changes: { namespace: guardada.namespace, key: guardada.key },
        });
        return guardada;
      });
      return { value: { namespace, key, setting }, resultCount: 1 };
    }),
  );

  server.registerTool(
    "delete_setting",
    {
      description: "Elimina una opción de configuración. Requiere confirmación explícita.",
      inputSchema: z.object({
        namespace: settingNameSchema,
        key: settingNameSchema,
        confirm: z.literal(true).describe("Confirmación explícita de que la opción debe eliminarse"),
      }),
    },
    async ({ namespace, key }) => traced(agent, "delete_setting", { namespace, key }, async (eventId) => {
      exigirEscritura();
      const eliminada = await withTransaction(async (client) => {
        const previa = await deleteSetting(client, namespace, key);
        if (!previa) return null;
        await registrarConfiguracion(client, {
          eventId,
          action: "setting_delete",
          changes: { namespace, key, previous: previa.value },
        });
        return previa;
      });
      if (!eliminada) throw new Error(`La opción ${namespace}.${key} no existe.`);
      return { value: { namespace, key, deleted: true, previous: eliminada.value }, resultCount: 1 };
    }),
  );

  server.registerTool(
    "list_attachments",
    {
      description:
        "Lista los archivos adjuntos de un registro, con nombre, tipo, tamaño y hash. No devuelve el contenido.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        recordId: z.string().uuid(),
      }),
    },
    async ({ entityKey, recordId }) => traced(
      agent,
      "list_attachments",
      { entityKey, recordId },
      async () => {
        // Los adjuntos heredan la autorización de su registro padre, no sólo el permiso
        // sobre la entidad: si el registro está fuera de alcance, sus archivos también.
        const entity = requireAgentPermission(agent, entityKey, "read");
        if (!resolveAttachmentPolicy(entity)) {
          throw new Error(`${entity.label_plural} no acepta archivos adjuntos.`);
        }
        const padre = await getRecord(entity.key, recordId, undefined, false, alcanceDeRegistros);
        if (!padre) {
          return { value: { entityKey: entity.key, recordId, found: false, attachments: [] as string[] }, resultCount: 0 };
        }
        const files = await listAttachments(entity.key, recordId);
        return {
          value: {
            entityKey: entity.key,
            recordId,
            found: true,
            attachments: files.map((file) => ({
              id: file.id,
              name: file.original_name,
              contentType: file.content_type,
              sizeBytes: file.size_bytes,
              sha256: file.sha256,
              createdAt: file.created_at,
            })),
          },
          resultCount: files.length,
        };
      },
    ),
  );

  server.registerTool(
    "read_attachment",
    {
      description:
        "Devuelve el contenido de un archivo adjunto en base64, junto con su tipo y hash para verificarlo.",
      inputSchema: z.object({
        attachmentId: z.string().uuid(),
      }),
    },
    async ({ attachmentId }) => traced(
      agent,
      "read_attachment",
      { attachmentId },
      async () => {
        // Primero los metadatos: traer los bytes antes de saber si se pueden entregar
        // carga en memoria un archivo que quizá no corresponde.
        const metadatos = await getAttachmentMetadata(attachmentId);
        if (!metadatos) return { value: { id: attachmentId, found: false }, resultCount: 0 };
        // El permiso se resuelve sobre la entidad dueña del archivo, no sobre el archivo:
        // un identificador conocido no puede saltear la matriz de permisos.
        const entity = requireAgentPermission(agent, metadatos.entity_key, "read");
        // Y además sobre el registro concreto: un adjunto no es más accesible que su padre.
        const padre = await getRecord(entity.key, String(metadatos.record_id), undefined, false, alcanceDeRegistros);
        if (!padre) return { value: { id: attachmentId, found: false }, resultCount: 0 };
        const file = await getAttachmentContent(attachmentId);
        if (!file) return { value: { id: attachmentId, found: false }, resultCount: 0 };
        const content = Buffer.from(file.content);
        const digest = createHash("sha256").update(content).digest("hex");
        if (digest !== file.sha256) {
          throw new Error("El contenido del archivo no coincide con su hash registrado.");
        }
        return {
          value: {
            id: file.id,
            found: true,
            entityKey: entity.key,
            recordId: file.record_id,
            name: file.original_name,
            contentType: file.content_type,
            sizeBytes: file.size_bytes,
            sha256: file.sha256,
            encoding: "base64",
            content: content.toString("base64"),
          },
          resultCount: 1,
        };
      },
    ),
  );

  server.registerTool(
    "count_records",
    {
      description: "Cuenta registros usando búsqueda textual y filtros validados por el esquema.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        search: z.string().max(500).optional(),
        filters: filtersSchema,
      }),
    },
    async ({ entityKey, search, filters }) => traced(
      agent,
      "count_records",
      { entityKey, search, filters },
      async () => {
        const entity = requireAgentPermission(agent, entityKey, "list");
        const count = await countFilteredRecords(entity.key, { search, filters, access: alcanceDeRegistros });
        return { value: { entityKey: entity.key, count }, resultCount: count };
      },
    ),
  );

  server.registerTool(
    "query_records",
    {
      description: "Consulta registros con búsqueda, filtros, orden y paginación acotada.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        search: z.string().max(500).optional(),
        filters: filtersSchema,
        sort: z.string().max(48).optional(),
        direction: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).max(1_000_000).default(0),
      }),
    },
    async ({ entityKey, search, filters, sort, direction, limit, offset }) => traced(
      agent,
      "query_records",
      { entityKey, search, filters, sort, direction, limit, offset },
      async () => {
        const entity = requireAgentPermission(agent, entityKey, "list");
        const allowedFields = new Set(entity.fields.map((field) => field.key));
        // Las relaciones se pueden filtrar --es lo que permite pedir los registros que
        // cuelgan de otro-- pero no ordenar: ordenar por un identificador no significa
        // nada para quien consulta.
        const filterableFields = new Set(allowedFields);
        for (const relationship of relationFields(entity)) {
          filterableFields.add(relationship.key);
          filterableFields.add(`${relationship.key}_id`);
        }
        const safeFilters = Object.fromEntries(
          Object.entries(filters ?? {}).filter(([field]) => filterableFields.has(field)),
        );
        const safeSort = sort && (allowedFields.has(sort) || ["id", "created_at", "updated_at"].includes(sort))
          ? sort
          : undefined;
        const [records, total] = await Promise.all([
          listRecords(entity.key, { search, filters: safeFilters, sort: safeSort, direction, limit, offset, access: alcanceDeRegistros }),
          countFilteredRecords(entity.key, { search, filters: safeFilters, access: alcanceDeRegistros }),
        ]);
        return {
          value: {
            entityKey: entity.key,
            total,
            limit,
            offset,
            records: records.map((record) => recordForAgent(entity.key, record)),
          },
          resultCount: records.length,
        };
      },
    ),
  );

  server.registerTool(
    "get_record",
    {
      description: "Obtiene un registro por entidad y UUID.",
      inputSchema: z.object({ entityKey: entityKeySchema, id: z.string().uuid() }),
    },
    async ({ entityKey, id }) => traced(agent, "get_record", { entityKey, id }, async () => {
      const entity = requireAgentPermission(agent, entityKey, "read");
      const record = await getRecord(entity.key, id, undefined, false, alcanceDeRegistros);
      return {
        value: record
          ? { found: true, entityKey: entity.key, record: recordForAgent(entity.key, record) }
          : { found: false, entityKey: entity.key, id },
        resultCount: record ? 1 : 0,
      };
    }),
  );

  server.registerTool(
    "export_snapshot",
    {
      description: "Exporta una fotografía determinista y acotada de entidades autorizadas.",
      inputSchema: z.object({
        entityKeys: z.array(entityKeySchema).max(10).optional(),
        maxRecordsPerEntity: z.number().int().min(1).max(100).default(100),
      }),
    },
    async ({ entityKeys, maxRecordsPerEntity }) => traced(
      agent,
      "export_snapshot",
      { entityKeys, maxRecordsPerEntity },
      async () => {
        const allowed = new Map(agentEntities(agent).map((entity) => [entity.key, entity]));
        const selected = [...new Set(entityKeys?.length ? entityKeys : [...allowed.keys()])];
        if (selected.some((key) => !allowed.has(key))) {
          throw new Error("El snapshot incluye una entidad inexistente o no autorizada.");
        }
        const entities = await Promise.all(selected.map(async (key) => {
          const entity = requireAgentPermission(agent, key, "list");
          const [records, total] = await Promise.all([
            listRecords(entity.key, { sort: "id", direction: "asc", limit: maxRecordsPerEntity, access: alcanceDeRegistros }),
            countFilteredRecords(entity.key, { access: alcanceDeRegistros }),
          ]);
          return {
            key: entity.key,
            total,
            truncated: total > records.length,
            records: records.map((record) => recordForAgent(entity.key, record)),
          };
        }));
        const snapshot = {
          app: { key: runtimeSpec.app.key, name: runtimeSpec.app.name },
          generated_at: new Date().toISOString(),
          entities,
        };
        const fingerprint = createHash("sha256").update(JSON.stringify(snapshot.entities)).digest("hex");
        return {
          value: { ...snapshot, fingerprint },
          resultCount: entities.reduce((sum, entity) => sum + entity.records.length, 0),
        };
      },
    ),
  );

  server.registerTool(
    "create_record",
    {
      description: "Crea un registro aplicando permisos, validaciones, reglas, idempotencia y auditoría.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        values: mutationValuesSchema,
        idempotencyKey: idempotencyKeySchema,
      }),
    },
    async ({ entityKey, values, idempotencyKey }) => traced(
      agent,
      "create_record",
      { entityKey, values, idempotencyKey },
      async (agentEventId) => {
        const entity = requireAgentPermission(agent, entityKey, "create");
        // El registro nace a nombre del responsable de la credencial, salvo que su
        // alcance sea total. Un agente no crea trabajo a nombre de terceros.
        const normalized = prepareRecordCreate(entity, recordInputFromObject(entity, values, "create"), alcanceDeRegistros);
        const mutation = await executeIdempotentMutation({
          agent,
          toolName: "create_record",
          entityKey: entity.key,
          idempotencyKey,
          request: { values: normalized },
          execute: async (client) => {
            const evaluated = applyRules({ entityKey: entity.key, event: "before_create", values: normalized });
            const recordId = await insertRecord(entity.key, evaluated.values, client, alcanceDeRegistros);
            const after = await getRecord(entity.key, recordId, client, false, alcanceDeRegistros);
            await recordAuditEvent(client, {
              ...(agent.kind === "user" ? { actorId: agent.id } : { agentId: agent.id }),
              agentEventId,
              entityKey: entity.key,
              recordId,
              action: "create",
              changes: { after, rules: evaluated.applied, source: "mcp" },
            });
            return {
              recordId,
              result: {
                entityKey: entity.key,
                record: after ? recordForAgent(entity.key, after) : null,
              },
            };
          },
        });
        // Un agente escribe fuera de la interfaz: sin esto, las vistas y los
        // listados siguen sirviendo la copia anterior.
        revalidateAfterWrite(entity.key);
        return { value: mutation, resultCount: 1 };
      },
    ),
  );

  server.registerTool(
    "update_record",
    {
      description: "Actualiza campos de un registro aplicando permisos, reglas, idempotencia y auditoría.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        id: z.string().uuid(),
        values: mutationValuesSchema,
        idempotencyKey: idempotencyKeySchema,
      }),
    },
    async ({ entityKey, id, values, idempotencyKey }) => traced(
      agent,
      "update_record",
      { entityKey, id, values, idempotencyKey },
      async (agentEventId) => {
        const entity = requireAgentPermission(agent, entityKey, "update");
        const normalized = recordInputFromObject(entity, values, "update");
        assertRecordOwnershipChange(entity, normalized, alcanceDeRegistros);
        const mutation = await executeIdempotentMutation({
          agent,
          toolName: "update_record",
          entityKey: entity.key,
          idempotencyKey,
          request: { id, values: normalized },
          execute: async (client) => {
            const before = await getRecord(entity.key, id, client, true, alcanceDeRegistros);
            if (!before) throw new Error("El registro que intentás modificar no existe.");
            const evaluated = applyRules({ entityKey: entity.key, event: "before_update", values: normalized, before });
            await updateRecord(entity.key, id, evaluated.values, client, alcanceDeRegistros);
            const after = await getRecord(entity.key, id, client, false, alcanceDeRegistros);
            await recordAuditEvent(client, {
              ...(agent.kind === "user" ? { actorId: agent.id } : { agentId: agent.id }),
              agentEventId,
              entityKey: entity.key,
              recordId: id,
              action: "update",
              changes: { before, after, rules: evaluated.applied, source: "mcp" },
            });
            return {
              recordId: id,
              result: {
                entityKey: entity.key,
                record: after ? recordForAgent(entity.key, after) : null,
              },
            };
          },
        });
        // Un agente escribe fuera de la interfaz: sin esto, las vistas y los
        // listados siguen sirviendo la copia anterior.
        revalidateAfterWrite(entity.key, id);
        return { value: mutation, resultCount: 1 };
      },
    ),
  );

  server.registerTool(
    "delete_record",
    {
      description: "Elimina un registro y sus adjuntos sólo con alcance de eliminación y confirmación explícita.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        id: z.string().uuid(),
        idempotencyKey: idempotencyKeySchema,
        confirm: z.literal(true),
      }),
    },
    async ({ entityKey, id, idempotencyKey, confirm }) => traced(
      agent,
      "delete_record",
      { entityKey, id, idempotencyKey, confirm },
      async (agentEventId) => {
        const entity = requireAgentPermission(agent, entityKey, "delete");
        const mutation = await executeIdempotentMutation({
          agent,
          toolName: "delete_record",
          entityKey: entity.key,
          idempotencyKey,
          request: { id, confirm },
          execute: async (client) => {
            const before = await getRecord(entity.key, id, client, true, alcanceDeRegistros);
            if (!before) throw new Error("El registro que intentás eliminar no existe.");
            const evaluated = applyRules({ entityKey: entity.key, event: "before_delete", values: {}, before });
            const deletedAttachments = await deleteAttachmentsForRecord(client, entity.key, id);
            await deleteRecord(entity.key, id, client, alcanceDeRegistros);
            await recordAuditEvent(client, {
              ...(agent.kind === "user" ? { actorId: agent.id } : { agentId: agent.id }),
              agentEventId,
              entityKey: entity.key,
              recordId: id,
              action: "delete",
              changes: { before, attachments: deletedAttachments, rules: evaluated.applied, source: "mcp" },
            });
            return {
              recordId: id,
              result: { entityKey: entity.key, id, deleted: true },
            };
          },
        });
        // Un agente escribe fuera de la interfaz: sin esto, las vistas y los
        // listados siguen sirviendo la copia anterior.
        revalidateAfterWrite(entity.key, id);
        return { value: mutation, resultCount: 1 };
      },
    ),
  );

  return server;
}
