import {
  type EntitySpec,
  type FieldSpec,
  type RuleCondition,
  type RuleEvent,
  type RuleOperand,
  type RuleSpec,
  relationFields,
  requireEntity,
  runtimeSpec,
} from "@/lib/spec";

export type MutationEvent = "before_create" | "before_update" | "before_delete";

export type AppliedRule = {
  ruleKey: string;
  label: string;
  event: MutationEvent;
  actions: Array<{ action: "set"; field: string; value: unknown }>;
};

export class RuleBlockedError extends Error {
  readonly ruleKey: string;
  readonly ruleLabel: string;

  constructor(rule: RuleSpec, message: string) {
    super(message);
    this.name = "RuleBlockedError";
    this.ruleKey = rule.key;
    this.ruleLabel = rule.label;
  }
}

type EvaluationContext = {
  entity: EntitySpec;
  event: MutationEvent;
  before: Record<string, unknown> | null;
  current: Record<string, unknown>;
  now: Date;
};

function fieldSpec(entity: EntitySpec, key: string): FieldSpec | { key: string; type: "relationship" } {
  const field = entity.fields.find((candidate) => candidate.key === key);
  if (field) return field;
  if (relationFields(entity).some((relationship) => `${relationship.key}_id` === key)) return { key, type: "relationship" };
  throw new Error(`La regla referencia un campo desconocido: ${entity.key}.${key}`);
}

function isEmpty(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function comparable(value: unknown, type: string): string | number | boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (type === "integer" || type === "decimal") return Number(value);
  if (type === "date" || type === "datetime") {
    const timestamp = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
    return Number.isNaN(timestamp) ? String(value) : timestamp;
  }
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function resolveOperand(value: unknown, field: FieldSpec | { key: string; type: "relationship" }, context: EvaluationContext) {
  if (value && typeof value === "object" && "source" in value) {
    const operand = value as RuleOperand;
    if (operand.source === "now") return field.type === "date" ? context.now.toISOString().slice(0, 10) : context.now.toISOString();
    return context.current[operand.field];
  }
  return value;
}

function equal(left: unknown, right: unknown, type: string) {
  return comparable(left, type) === comparable(right, type);
}

function evaluateCondition(condition: RuleCondition, context: EvaluationContext): boolean {
  if ("all" in condition) return condition.all.every((child) => evaluateCondition(child, context));
  if ("any" in condition) return condition.any.some((child) => evaluateCondition(child, context));
  if ("not" in condition) return !evaluateCondition(condition.not, context);

  const field = fieldSpec(context.entity, condition.field);
  const left = context.current[condition.field];
  if (condition.operator === "is_empty") return isEmpty(left);
  if (condition.operator === "is_not_empty") return !isEmpty(left);
  if (condition.operator === "changed") return !equal(left, context.before?.[condition.field], field.type);
  if (condition.operator === "not_changed") return equal(left, context.before?.[condition.field], field.type);
  if (!("value" in condition)) return false;

  const right = resolveOperand(condition.value, field, context);
  if (condition.operator === "eq") return equal(left, right, field.type);
  if (condition.operator === "neq") return !equal(left, right, field.type);
  if (condition.operator === "in" || condition.operator === "not_in") {
    const found = Array.isArray(right) && right.some((candidate) => equal(left, candidate, field.type));
    return condition.operator === "in" ? found : !found;
  }
  if (condition.operator === "contains") {
    const found = typeof left === "string"
      ? left.includes(String(right ?? ""))
      : Array.isArray(left) && left.some((candidate) => equal(candidate, right, field.type));
    return found;
  }
  const normalizedLeft = comparable(left, field.type);
  const normalizedRight = comparable(right, field.type);
  if (normalizedLeft === null || normalizedLeft === undefined || normalizedRight === null || normalizedRight === undefined) return false;
  const order = typeof normalizedLeft === "number" && typeof normalizedRight === "number"
    ? normalizedLeft - normalizedRight
    : String(normalizedLeft).localeCompare(String(normalizedRight));
  if (condition.operator === "gt") return order > 0;
  if (condition.operator === "gte") return order >= 0;
  if (condition.operator === "lt") return order < 0;
  return order <= 0;
}

function applicableRules(entityKey: string, event: MutationEvent) {
  return (runtimeSpec.rules ?? [])
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled !== false && rule.when.entity === entityKey && (
      rule.when.event === event || (rule.when.event === "before_save" && event !== "before_delete")
    ))
    .sort((left, right) => (left.rule.priority ?? 100) - (right.rule.priority ?? 100) || left.index - right.index)
    .map(({ rule }) => rule);
}

export function applyRules(input: {
  entityKey: string;
  event: MutationEvent;
  values: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  now?: Date;
}) {
  const entity = requireEntity(input.entityKey);
  const before = input.before ?? null;
  const values = { ...input.values };
  const context: EvaluationContext = {
    entity,
    event: input.event,
    before,
    current: { ...(before ?? {}), ...values },
    now: input.now ?? new Date(),
  };
  const applied: AppliedRule[] = [];
  for (const rule of applicableRules(entity.key, input.event)) {
    if (!evaluateCondition(rule.if, context)) continue;
    const appliedActions: AppliedRule["actions"] = [];
    for (const action of rule.then) {
      if (action.action === "block") throw new RuleBlockedError(rule, action.message);
      if (input.event === "before_delete") throw new Error(`La regla ${rule.key} no puede asignar valores antes de eliminar.`);
      const target = fieldSpec(entity, action.field);
      const value = resolveOperand(action.value, target, context);
      values[action.field] = value;
      context.current[action.field] = value;
      appliedActions.push({ action: "set", field: action.field, value });
    }
    applied.push({ ruleKey: rule.key, label: rule.label, event: input.event, actions: appliedActions });
  }
  return { values, applied };
}

export function rulesForEntity(entityKey: string) {
  return (runtimeSpec.rules ?? []).filter((rule) => rule.when.entity === entityKey);
}

export const ruleEventLabels: Record<RuleEvent, string> = {
  before_create: "Antes de crear",
  before_update: "Antes de modificar",
  before_delete: "Antes de eliminar",
  before_save: "Antes de crear o modificar",
};
