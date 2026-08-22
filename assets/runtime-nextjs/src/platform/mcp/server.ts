import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentEntities, requireAgentPermission } from "@/platform/mcp/access";
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
import { recordAuditEvent } from "@/lib/audit";
import {
  deleteAttachmentsForRecord,
  getAttachmentContent,
  listAttachments,
  resolveAttachmentPolicy,
} from "@/lib/attachments";
import { applyRules } from "@/lib/rules";
import { relationFields, requireEntity, runtimeSpec } from "@/lib/spec";

const entityKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
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

async function traced<T extends Record<string, unknown>>(
  agent: AgentPrincipal,
  toolName: string,
  input: Record<string, unknown>,
  execute: (eventId: string) => Promise<{ value: T; resultCount?: number }>,
) {
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
        // Los adjuntos heredan el permiso de lectura de su entidad, igual que en la interfaz.
        const entity = requireAgentPermission(agent, entityKey, "read");
        if (!resolveAttachmentPolicy(entity)) {
          throw new Error(`${entity.label_plural} no acepta archivos adjuntos.`);
        }
        const files = await listAttachments(entity.key, recordId);
        return {
          value: {
            entityKey: entity.key,
            recordId,
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
        const file = await getAttachmentContent(attachmentId);
        if (!file) throw new Error("El archivo no existe.");
        // El permiso se resuelve sobre la entidad dueña del archivo, no sobre el archivo:
        // un identificador conocido no puede saltear la matriz de permisos.
        const entity = requireAgentPermission(agent, file.entity_key, "read");
        const content = Buffer.from(file.content);
        const digest = createHash("sha256").update(content).digest("hex");
        if (digest !== file.sha256) {
          throw new Error("El contenido del archivo no coincide con su hash registrado.");
        }
        return {
          value: {
            id: file.id,
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
        const count = await countFilteredRecords(entity.key, { search, filters });
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
          listRecords(entity.key, { search, filters: safeFilters, sort: safeSort, direction, limit, offset }),
          countFilteredRecords(entity.key, { search, filters: safeFilters }),
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
      const record = await getRecord(entity.key, id);
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
            listRecords(entity.key, { sort: "id", direction: "asc", limit: maxRecordsPerEntity }),
            countFilteredRecords(entity.key),
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
        const normalized = recordInputFromObject(entity, values, "create");
        const mutation = await executeIdempotentMutation({
          agent,
          toolName: "create_record",
          entityKey: entity.key,
          idempotencyKey,
          request: { values: normalized },
          execute: async (client) => {
            const evaluated = applyRules({ entityKey: entity.key, event: "before_create", values: normalized });
            const recordId = await insertRecord(entity.key, evaluated.values, client);
            const after = await getRecord(entity.key, recordId, client);
            await recordAuditEvent(client, {
              agentId: agent.id,
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
        const mutation = await executeIdempotentMutation({
          agent,
          toolName: "update_record",
          entityKey: entity.key,
          idempotencyKey,
          request: { id, values: normalized },
          execute: async (client) => {
            const before = await getRecord(entity.key, id, client, true);
            if (!before) throw new Error("El registro que intentás modificar no existe.");
            const evaluated = applyRules({ entityKey: entity.key, event: "before_update", values: normalized, before });
            await updateRecord(entity.key, id, evaluated.values, client);
            const after = await getRecord(entity.key, id, client);
            await recordAuditEvent(client, {
              agentId: agent.id,
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
            const before = await getRecord(entity.key, id, client, true);
            if (!before) throw new Error("El registro que intentás eliminar no existe.");
            const evaluated = applyRules({ entityKey: entity.key, event: "before_delete", values: {}, before });
            const deletedAttachments = await deleteAttachmentsForRecord(client, entity.key, id);
            await deleteRecord(entity.key, id, client);
            await recordAuditEvent(client, {
              agentId: agent.id,
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
        return { value: mutation, resultCount: 1 };
      },
    ),
  );

  return server;
}
