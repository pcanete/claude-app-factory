# AppSpec v0

AppSpec is the stable boundary between a natural-language request and generated software. It describes business structure without prescribing a CRM, ERP, case-management, or other vertical.

## Root

Required keys:

- `version`: currently `0.1`.
- `app`: identity and presentation defaults.
- `roles`: application roles.
- `entities`: domain entities.
- `views`: navigation and standard presentations.

Optional keys:

- `rules`: declarative business rules executed by the runtime.
- `decisions`: assumptions, confirmed decisions, and unresolved questions.

## App

```json
{
  "app": {
    "key": "control_mantenimiento",
    "name": "Control de mantenimiento",
    "description": "Gestiona equipos, técnicos y órdenes de trabajo",
    "locale": "es-AR",
    "timezone": "America/Argentina/Buenos_Aires",
    "theme": {
      "primary": "#5B5BD6",
      "surface": "#111318"
    }
  }
}
```

Keys use `snake_case`, must match `^[a-z][a-z0-9_]*$`, and have at most 48 characters. Labels are human-facing and may contain spaces or accents.

## Roles and permissions

Each role has a stable key and label. Entity permissions list one or more of `list`, `read`, `create`, `update`, and `delete`.

```json
{
  "roles": [
    {"key": "admin", "label": "Administrador"},
    {"key": "technician", "label": "Técnico"}
  ]
}
```

Every entity must define permissions explicitly. The compiler rejects unknown roles or actions.

## Entities

```json
{
  "key": "work_order",
  "label": "Orden de trabajo",
  "label_plural": "Órdenes de trabajo",
  "description": "Intervenciones planificadas o correctivas",
  "title_field": "summary",
  "fields": [],
  "relationships": [],
  "permissions": {
    "admin": ["list", "read", "create", "update", "delete"],
    "technician": ["list", "read", "update"]
  }
}
```

The compiler adds `id`, `created_at`, and `updated_at`; do not declare them as fields.

Supported v0 field types:

| Type | PostgreSQL representation | Notes |
|---|---|---|
| `text` | `text` | Short or searchable text |
| `long_text` | `text` | Long content |
| `integer` | `bigint` | Whole numbers |
| `decimal` | `numeric(18,4)` | Money or measurements; currency semantics belong in the domain |
| `boolean` | `boolean` | True/false |
| `date` | `date` | Calendar date |
| `datetime` | `timestamptz` | Absolute instant |
| `email` | `text` | UI semantics and validation |
| `url` | `text` | UI semantics and validation |
| `enum` | `text` + check | Requires non-empty `options` |
| `file` | `jsonb` | Storage metadata, not file bytes |
| `json` | `jsonb` | Escape hatch; prefer explicit fields |

Field options:

- `required`, `unique`, `searchable`: booleans.
- `default`: scalar compatible with the type.
- `options`: array of `{key,label}` for enum fields.
- `help`: user-facing explanation.

Entities may opt into universal record attachments:

```json
{
  "attachments": {
    "enabled": true,
    "max_files": 20,
    "max_size_mb": 3,
    "allowed_types": ["application/pdf", "image/jpeg", "image/png"]
  }
}
```

Attachments are stored outside the entity row, inherit the entity's `read` and `update` permissions, and are audited. The built-in PostgreSQL adapter is intentionally limited to 4 MB per file; large-file or direct-upload requirements belong behind the client-owned storage adapter.

Relationships support:

- `belongs_to`: adds a foreign-key column on the current entity.
- `has_many`: inverse navigation metadata; it does not add a column.
- `many_to_many`: reserved in v0 and rejected by the compiler until junction-table semantics are implemented.

For `belongs_to`, provide `key`, `label`, `target`, `required`, and `on_delete` (`restrict`, `cascade`, `set_null`).

## Views

Accepted v0 types are `table`, `form`, `detail`, `dashboard`, `calendar`, and `kanban`. Named `table`, `dashboard`, `calendar`, and `kanban` views have independent runtime routes. Form and detail metadata continue to configure the standard entity routes.

```json
{
  "key": "open_orders",
  "label": "Órdenes abiertas",
  "type": "table",
  "entity": "work_order",
  "navigation": true,
  "fields": ["summary", "status", "scheduled_for"]
}
```

Table views support dynamic field filters, free-text search across searchable fields, and validated ordering. Optional configuration:

```json
{
  "default_sort": {"field": "scheduled_for", "direction": "asc"},
  "page_size": 50,
  "bulk_edit_fields": ["status", "approved"]
}
```

Lists are paginated. `bulk_edit_fields` is opt-in and may reference only enum or boolean fields; a bulk mutation is capped at 100 records, executes atomically, and applies the same permissions, rules, and audit trail as an individual edit.

Kanban views require `entity` and `group_by`; `group_by` must reference an enum field. Set `allow_move: true` to opt into audited card moves. Calendar views require `entity` and `date_field`, which must reference a date or datetime field; `end_date_field` is optional. Set `allow_reschedule: true` to opt into audited date changes. Both operations require `update` permission and pass through deterministic rules. Dashboard views contain one or more deterministic widgets:

```json
{
  "key": "operations",
  "label": "Operación",
  "type": "dashboard",
  "navigation": true,
  "widgets": [
    {"key": "open_total", "label": "Abiertas", "type": "metric", "entity": "work_order", "aggregate": "count"},
    {"key": "by_status", "label": "Por estado", "type": "breakdown", "entity": "work_order", "group_by": "status"},
    {"key": "recent", "label": "Recientes", "type": "recent", "entity": "work_order", "fields": ["summary", "status"], "limit": 5}
  ]
}
```

Metric widgets accept `count`, `sum`, or `avg`; `sum` and `avg` require a numeric `field`. Dashboard widgets never execute arbitrary SQL.

## Rules

Rules are deliberately small and deterministic. The runtime executes them on the server before a mutation; no arbitrary code, network call, email, integration, or AI action is accepted.

```json
{
  "key": "prevent_invalid_schedule",
  "label": "Prevent invalid schedules",
  "priority": 20,
  "enabled": true,
  "when": {"entity": "work_order", "event": "before_save"},
  "if": {
    "all": [
      {"field": "scheduled_for", "operator": "is_not_empty"},
      {"field": "scheduled_for", "operator": "lt", "value": {"source": "now"}}
    ]
  },
  "then": [{"action": "block", "message": "Scheduled time cannot be in the past."}]
}
```

Accepted events are `before_create`, `before_update`, `before_delete`, and `before_save`; `before_save` applies to create and update. Rules run by ascending priority and then declaration order.

Conditions are structured trees:

- logical nodes: `all`, `any`, and `not`;
- comparisons: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`, and `contains`;
- state checks: `is_empty`, `is_not_empty`, `changed`, and `not_changed`;
- comparison values may be literals, `{ "source": "now" }`, or `{ "source": "field", "field": "other_field" }`.

Actions are limited to:

- `{ "action": "set", "field": "priority", "value": "high" }`;
- `{ "action": "block", "message": "Explanation shown to the user." }`.

`set` can also use a field or current-time source. A `before_delete` rule may only block. Every execution is recorded inside the mutation's audit event. Multi-step approvals and side effects remain client features.

## Decisions

```json
{
  "decisions": [
    {
      "status": "assumption",
      "topic": "file_retention",
      "statement": "Conservar archivos mientras el registro exista"
    }
  ]
}
```

Allowed statuses are `confirmed`, `assumption`, and `unresolved`.

## Compilation invariants

- Entity and field keys are unique.
- Relationships target existing entities.
- `title_field` references a declared field.
- Permission roles exist.
- View fields exist on the referenced entity.
- Attachment policies are bounded and contain valid MIME patterns.
- Kanban, calendar, bulk-edit, sorting, and dashboard widget fields are type-compatible.
- Generated SQL uses only validated identifiers.
- Output never overwrites a non-empty project directory.
