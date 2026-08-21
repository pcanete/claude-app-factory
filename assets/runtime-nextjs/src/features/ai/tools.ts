import { tool } from "ai";
import { z } from "zod";
import type { RuntimeUser } from "@/lib/auth-types";
import { hasPermission } from "@/lib/auth";
import { countFilteredRecords, getRecord, listRecords } from "@/lib/repository";
import { relationFields, requireEntity } from "@/lib/spec";
import { assistantEntities } from "@/features/ai/access";

function assertPermission(user: RuntimeUser, entityKey: string, action: "list" | "read") {
  const entity = requireEntity(entityKey);
  if (!hasPermission(user, entity.key, action)) {
    throw new Error(`No tenés permiso para ${action === "list" ? "listar" : "leer"} ${entity.label_plural}.`);
  }
  return entity;
}

function boundedValue(value: unknown): unknown {
  if (typeof value === "string") return value.length > 1_000 ? `${value.slice(0, 997)}…` : value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  const serialized = JSON.stringify(value);
  return serialized.length > 2_000 ? `${serialized.slice(0, 1_997)}…` : value;
}

function recordResult(entityKey: string, record: Record<string, unknown>) {
  const entity = requireEntity(entityKey);
  const values = Object.fromEntries([
    ...entity.fields.map((field) => [field.key, boundedValue(record[field.key])]),
    ...relationFields(entity).map((relationship) => [
      `${relationship.key}_id`,
      boundedValue(record[`${relationship.key}_id`]),
    ]),
  ]);
  const id = String(record.id);
  return {
    id,
    label: String(record[entity.title_field] ?? id),
    href: `/records/${entity.key}/${id}`,
    values,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

const entityKeySchema = z.string().min(1).max(48).describe("Clave exacta de una entidad disponible");

export function createReadOnlyApplicationTools(user: RuntimeUser) {
  return {
    listEntities: tool({
      description: "Lista las entidades que el usuario actual puede consultar, con sus campos y relaciones.",
      inputSchema: z.object({}),
      execute: async () => ({
        entities: assistantEntities(user).map((entity) => ({
          key: entity.key,
          label: entity.label,
          labelPlural: entity.label_plural,
          description: entity.description,
          titleField: entity.title_field,
          permissions: {
            list: hasPermission(user, entity.key, "list"),
            read: hasPermission(user, entity.key, "read"),
          },
          fields: entity.fields.map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            searchable: Boolean(field.searchable),
            options: field.options,
          })),
          relationships: relationFields(entity).map((relationship) => ({
            key: relationship.key,
            label: relationship.label,
            target: relationship.target,
          })),
        })),
      }),
    }),

    countRecords: tool({
      description: "Cuenta registros de una entidad, opcionalmente aplicando búsqueda textual y filtros por campo.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        search: z.string().max(200).optional(),
        filters: z.record(z.string(), z.string().max(200)).optional(),
      }),
      execute: async ({ entityKey, search, filters }) => {
        const entity = assertPermission(user, entityKey, "list");
        const count = await countFilteredRecords(entity.key, { search, filters });
        return { entityKey: entity.key, label: entity.label_plural, count };
      },
    }),

    searchRecords: tool({
      description: "Busca y ordena un conjunto acotado de registros. Devuelve enlaces internos y valores de campos.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        search: z.string().max(200).optional(),
        filters: z.record(z.string(), z.string().max(200)).optional(),
        sort: z.string().max(48).optional(),
        direction: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(25).default(10),
      }),
      execute: async ({ entityKey, search, filters, sort, direction, limit }) => {
        const entity = assertPermission(user, entityKey, "list");
        const allowedFields = new Set(entity.fields.map((field) => field.key));
        const safeFilters = Object.fromEntries(
          Object.entries(filters ?? {}).filter(([field]) => allowedFields.has(field)),
        );
        const safeSort = sort && (allowedFields.has(sort) || ["created_at", "updated_at"].includes(sort))
          ? sort
          : undefined;
        const rows = await listRecords(entity.key, {
          search,
          filters: safeFilters,
          sort: safeSort,
          direction,
          limit,
        });
        return {
          entityKey: entity.key,
          label: entity.label_plural,
          returned: rows.length,
          records: rows.map((record) => recordResult(entity.key, record)),
        };
      },
    }),

    getRecord: tool({
      description: "Obtiene un registro individual por su UUID y devuelve un enlace interno a su ficha.",
      inputSchema: z.object({
        entityKey: entityKeySchema,
        id: z.string().uuid(),
      }),
      execute: async ({ entityKey, id }) => {
        const entity = assertPermission(user, entityKey, "read");
        const record = await getRecord(entity.key, id);
        return record
          ? { found: true as const, entityKey: entity.key, record: recordResult(entity.key, record) }
          : { found: false as const, entityKey: entity.key, id };
      },
    }),
  };
}
