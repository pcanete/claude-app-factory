import { appSpec } from "@/generated/app-spec";

export type FieldType =
  | "text"
  | "long_text"
  | "integer"
  | "decimal"
  | "boolean"
  | "date"
  | "datetime"
  | "email"
  | "url"
  | "enum"
  | "file"
  | "json";

export type FieldSpec = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  searchable?: boolean;
  default?: unknown;
  help?: string;
  options?: Array<{ key: string; label: string }>;
};

export type RelationshipSpec = {
  key: string;
  label: string;
  type: "belongs_to" | "has_many" | "many_to_many";
  target: string;
  required?: boolean;
  on_delete?: "restrict" | "cascade" | "set_null";
};

export type AttachmentPolicy = {
  enabled: boolean;
  max_files?: number;
  max_size_mb?: number;
  allowed_types?: string[];
};

export type EntitySpec = {
  key: string;
  label: string;
  label_plural: string;
  description?: string;
  title_field: string;
  fields: FieldSpec[];
  relationships?: RelationshipSpec[];
  attachments?: AttachmentPolicy;
  permissions: Record<string, Array<"list" | "read" | "create" | "update" | "delete">>;
};

export type ViewType = "table" | "form" | "detail" | "dashboard" | "calendar" | "kanban";
export type DashboardWidgetSpec = {
  key: string;
  label: string;
  type: "metric" | "breakdown" | "recent";
  entity: string;
  aggregate?: "count" | "sum" | "avg";
  field?: string;
  group_by?: string;
  fields?: string[];
  limit?: number;
};
export type ViewSpec = {
  key: string;
  label: string;
  type: ViewType;
  entity?: string;
  navigation?: boolean;
  fields?: string[];
  default_sort?: { field: string; direction: "asc" | "desc" };
  page_size?: number;
  bulk_edit_fields?: string[];
  group_by?: string;
  allow_move?: boolean;
  date_field?: string;
  end_date_field?: string;
  allow_reschedule?: boolean;
  widgets?: DashboardWidgetSpec[];
};

export type RuleEvent = "before_create" | "before_update" | "before_delete" | "before_save";
export type RuleOperand = { source: "now" } | { source: "field"; field: string };
export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { field: string; operator: "is_empty" | "is_not_empty" | "changed" | "not_changed" }
  | { field: string; operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains"; value: unknown };
export type RuleAction =
  | { action: "set"; field: string; value: unknown }
  | { action: "block"; message: string };
export type RuleSpec = {
  key: string;
  label: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  when: { entity: string; event: RuleEvent };
  if: RuleCondition;
  then: RuleAction[];
};

export type RuntimeSpec = {
  version: string;
  app: {
    key: string;
    name: string;
    description: string;
    locale?: string;
    timezone?: string;
    theme?: { primary?: string; surface?: string };
  };
  roles: Array<{ key: string; label: string }>;
  entities: EntitySpec[];
  views: ViewSpec[];
  rules?: RuleSpec[];
  decisions?: Array<Record<string, unknown>>;
};

export const runtimeSpec = appSpec as unknown as RuntimeSpec;

export function getEntity(entityKey: string): EntitySpec | null {
  return runtimeSpec.entities.find((entity) => entity.key === entityKey) ?? null;
}

export function requireEntity(entityKey: string): EntitySpec {
  const entity = getEntity(entityKey);
  if (!entity) throw new Error(`Entidad desconocida: ${entityKey}`);
  return entity;
}

export function getView(viewKey: string): ViewSpec | null {
  return runtimeSpec.views.find((view) => view.key === viewKey) ?? null;
}

export function requireView(viewKey: string): ViewSpec {
  const view = getView(viewKey);
  if (!view) throw new Error(`Vista desconocida: ${viewKey}`);
  return view;
}

export function relationFields(entity: EntitySpec) {
  return (entity.relationships ?? []).filter((relationship) => relationship.type === "belongs_to");
}
