#!/usr/bin/env python3
"""Validate an AppSpec v0 and compile a neutral application foundation."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Any


IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")
FIELD_TYPES = {
    "text",
    "long_text",
    "integer",
    "decimal",
    "boolean",
    "date",
    "datetime",
    "email",
    "url",
    "enum",
    "file",
    "json",
}
VIEW_TYPES = {"table", "form", "detail", "dashboard", "calendar", "kanban"}
ACTIONS = {"list", "read", "create", "update", "delete"}
RELATIONSHIP_TYPES = {"belongs_to", "has_many", "many_to_many"}
DELETE_ACTIONS = {"restrict", "cascade", "set_null"}
DECISION_STATUSES = {"confirmed", "assumption", "unresolved"}
RULE_EVENTS = {"before_create", "before_update", "before_delete", "before_save"}
RULE_VALUE_OPERATORS = {"eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains"}
RULE_STATE_OPERATORS = {"is_empty", "is_not_empty", "changed", "not_changed"}
SYSTEM_FIELDS = {"id", "created_at", "updated_at"}
CORE_TABLES = {"app_role", "app_user", "app_audit_log", "app_import_batch", "app_attachment"}
MIME_PATTERN = re.compile(r"^[a-z0-9.+-]+/(?:\*|[a-z0-9.+-]+)$")


class SpecError(ValueError):
    pass


def is_identifier(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 48 and bool(IDENTIFIER.fullmatch(value))


def required_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def duplicates(values: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicate_values: set[str] = set()
    for value in values:
        if value in seen:
            duplicate_values.add(value)
        seen.add(value)
    return sorted(duplicate_values)


def rule_field_map(entity: dict[str, Any]) -> dict[str, dict[str, Any]]:
    fields = {
        field["key"]: field
        for field in entity.get("fields", [])
        if isinstance(field, dict) and is_identifier(field.get("key"))
    }
    for relationship in entity.get("relationships", []):
        if (
            isinstance(relationship, dict)
            and relationship.get("type") == "belongs_to"
            and is_identifier(relationship.get("key"))
        ):
            fields[f"{relationship['key']}_id"] = {
                "key": f"{relationship['key']}_id",
                "type": "relationship",
            }
    return fields


def rule_type_group(field: dict[str, Any]) -> str:
    field_type = field.get("type")
    if field_type in {"integer", "decimal"}:
        return "number"
    if field_type in {"date", "datetime"}:
        return "temporal"
    return str(field_type)


def rule_literal_compatible(field: dict[str, Any], value: Any) -> bool:
    if value is None:
        return True
    field_type = field.get("type")
    if field_type == "boolean":
        return isinstance(value, bool)
    if field_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if field_type == "decimal":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if field_type == "enum":
        return isinstance(value, str) and value in {
            option.get("key") for option in field.get("options", []) if isinstance(option, dict)
        }
    if field_type in {"text", "long_text", "date", "datetime", "email", "url", "relationship"}:
        return isinstance(value, str)
    return True


def validate_rule_value(
    value: Any,
    path: str,
    target_field: dict[str, Any],
    fields: dict[str, dict[str, Any]],
    errors: list[str],
    *,
    assignment: bool = False,
) -> None:
    if isinstance(value, dict) and "source" in value:
        source = value.get("source")
        allowed = {"source"} if source == "now" else {"source", "field"}
        for key in sorted(set(value) - allowed):
            errors.append(f"{path} contains unknown property '{key}'.")
        if source == "now":
            if rule_type_group(target_field) != "temporal":
                errors.append(f"{path} can use source 'now' only with date or datetime fields.")
        elif source == "field":
            source_key = value.get("field")
            if source_key not in fields:
                errors.append(f"{path}.field references unknown field '{source_key}'.")
            elif assignment and fields[source_key].get("type") != target_field.get("type"):
                errors.append(f"{path}.field must have the same type as the assigned field.")
            elif not assignment and rule_type_group(fields[source_key]) != rule_type_group(target_field):
                errors.append(f"{path}.field is not comparable with the condition field.")
        else:
            errors.append(f"{path}.source must be 'now' or 'field'.")
        return
    if not rule_literal_compatible(target_field, value):
        errors.append(f"{path} is incompatible with field type '{target_field.get('type')}'.")


def validate_rule_condition(
    condition: Any,
    path: str,
    fields: dict[str, dict[str, Any]],
    errors: list[str],
    depth: int = 0,
) -> int:
    if depth > 8:
        errors.append(f"{path} exceeds the maximum condition depth of 8.")
        return 1
    if not isinstance(condition, dict):
        errors.append(f"{path} must be a condition object.")
        return 1
    logical_keys = [key for key in ("all", "any", "not") if key in condition]
    if logical_keys:
        if len(logical_keys) != 1 or len(condition) != 1:
            errors.append(f"{path} must contain exactly one logical operator.")
            return 1
        key = logical_keys[0]
        children = condition[key]
        if key == "not":
            return 1 + validate_rule_condition(children, f"{path}.not", fields, errors, depth + 1)
        if not isinstance(children, list) or not children:
            errors.append(f"{path}.{key} must be a non-empty array.")
            return 1
        return 1 + sum(
            validate_rule_condition(child, f"{path}.{key}[{index}]", fields, errors, depth + 1)
            for index, child in enumerate(children)
        )

    allowed = {"field", "operator", "value"}
    for key in sorted(set(condition) - allowed):
        errors.append(f"{path} contains unknown property '{key}'.")
    field_key = condition.get("field")
    operator = condition.get("operator")
    if field_key not in fields:
        errors.append(f"{path}.field references unknown field '{field_key}'.")
        return 1
    field = fields[field_key]
    if operator in RULE_STATE_OPERATORS:
        if "value" in condition:
            errors.append(f"{path}.value is not allowed for operator '{operator}'.")
    elif operator in RULE_VALUE_OPERATORS:
        if "value" not in condition:
            errors.append(f"{path}.value is required for operator '{operator}'.")
        elif operator in {"in", "not_in"}:
            values = condition["value"]
            if not isinstance(values, list) or not values:
                errors.append(f"{path}.value must be a non-empty array for operator '{operator}'.")
            else:
                for index, value in enumerate(values):
                    if isinstance(value, dict):
                        errors.append(f"{path}.value[{index}] must be a literal value.")
                    else:
                        validate_rule_value(value, f"{path}.value[{index}]", field, fields, errors)
        else:
            validate_rule_value(condition["value"], f"{path}.value", field, fields, errors)
        if operator in {"gt", "gte", "lt", "lte"} and rule_type_group(field) not in {"number", "temporal"}:
            errors.append(f"{path}.operator '{operator}' requires a numeric or temporal field.")
        if operator == "contains" and field.get("type") not in {"text", "long_text", "email", "url", "json"}:
            errors.append(f"{path}.operator 'contains' is not supported for field type '{field.get('type')}'.")
    else:
        errors.append(f"{path}.operator is invalid.")
    return 1


def validate_spec(spec: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(spec, dict):
        return ["The AppSpec root must be an object."]
    root_keys = {"version", "app", "roles", "entities", "views", "rules", "decisions"}
    for key in sorted(set(spec) - root_keys):
        errors.append(f"Unknown root property: {key}.")
    if spec.get("version") != "0.1":
        errors.append("version must be '0.1'.")

    app = spec.get("app")
    if not isinstance(app, dict):
        errors.append("app must be an object.")
    else:
        if not is_identifier(app.get("key")):
            errors.append("app.key must be a snake_case identifier.")
        for key in ("name", "description"):
            if not required_string(app.get(key)):
                errors.append(f"app.{key} must be a non-empty string.")

    roles = spec.get("roles")
    role_keys: list[str] = []
    if not isinstance(roles, list) or not roles:
        errors.append("roles must be a non-empty array.")
    else:
        for index, role in enumerate(roles):
            path = f"roles[{index}]"
            if not isinstance(role, dict):
                errors.append(f"{path} must be an object.")
                continue
            if not is_identifier(role.get("key")):
                errors.append(f"{path}.key must be a snake_case identifier.")
            else:
                role_keys.append(role["key"])
            if not required_string(role.get("label")):
                errors.append(f"{path}.label must be a non-empty string.")
        for key in duplicates(role_keys):
            errors.append(f"Duplicate role key: {key}.")

    entities = spec.get("entities")
    entity_keys: list[str] = []
    entity_fields: dict[str, set[str]] = {}
    entity_field_specs: dict[str, dict[str, dict[str, Any]]] = {}
    if not isinstance(entities, list) or not entities:
        errors.append("entities must be a non-empty array.")
        entities = []
    for entity_index, entity in enumerate(entities):
        path = f"entities[{entity_index}]"
        if not isinstance(entity, dict):
            errors.append(f"{path} must be an object.")
            continue
        entity_key = entity.get("key")
        if not is_identifier(entity_key):
            errors.append(f"{path}.key must be a snake_case identifier.")
            entity_key = f"invalid_{entity_index}"
        else:
            entity_keys.append(entity_key)
            if entity_key in CORE_TABLES:
                errors.append(f"{path}.key '{entity_key}' is reserved by the application kernel.")
        for key in ("label", "label_plural"):
            if not required_string(entity.get(key)):
                errors.append(f"{path}.{key} must be a non-empty string.")

        fields = entity.get("fields")
        field_keys: list[str] = []
        if not isinstance(fields, list) or not fields:
            errors.append(f"{path}.fields must be a non-empty array.")
            fields = []
        for field_index, field in enumerate(fields):
            field_path = f"{path}.fields[{field_index}]"
            if not isinstance(field, dict):
                errors.append(f"{field_path} must be an object.")
                continue
            field_key = field.get("key")
            if not is_identifier(field_key):
                errors.append(f"{field_path}.key must be a snake_case identifier.")
            else:
                field_keys.append(field_key)
                if field_key in SYSTEM_FIELDS:
                    errors.append(f"{field_path}.key '{field_key}' is reserved.")
            if not required_string(field.get("label")):
                errors.append(f"{field_path}.label must be a non-empty string.")
            field_type = field.get("type")
            if field_type not in FIELD_TYPES:
                errors.append(f"{field_path}.type is not supported in AppSpec v0.")
            if field_type == "enum":
                options = field.get("options")
                if not isinstance(options, list) or not options:
                    errors.append(f"{field_path}.options must be non-empty for enum fields.")
                else:
                    option_keys: list[str] = []
                    for option_index, option in enumerate(options):
                        option_path = f"{field_path}.options[{option_index}]"
                        if not isinstance(option, dict) or not is_identifier(option.get("key")):
                            errors.append(f"{option_path}.key must be a snake_case identifier.")
                        else:
                            option_keys.append(option["key"])
                        if not isinstance(option, dict) or not required_string(option.get("label")):
                            errors.append(f"{option_path}.label must be a non-empty string.")
                    for key in duplicates(option_keys):
                        errors.append(f"Duplicate enum option '{key}' at {field_path}.")
                    if "default" in field and field["default"] not in option_keys:
                        errors.append(f"{field_path}.default must reference an enum option key.")
        for key in duplicates(field_keys):
            errors.append(f"Duplicate field key '{key}' in entity '{entity_key}'.")
        field_key_set = set(field_keys)
        entity_fields[entity_key] = field_key_set
        entity_field_specs[entity_key] = {
            field["key"]: field
            for field in fields
            if isinstance(field, dict) and is_identifier(field.get("key"))
        }
        if entity.get("title_field") not in field_key_set:
            errors.append(f"{path}.title_field must reference a declared field.")

        attachments = entity.get("attachments")
        if attachments is not None:
            attachment_path = f"{path}.attachments"
            if not isinstance(attachments, dict):
                errors.append(f"{attachment_path} must be an object.")
            else:
                allowed_keys = {"enabled", "max_files", "max_size_mb", "allowed_types"}
                for key in sorted(set(attachments) - allowed_keys):
                    errors.append(f"{attachment_path} contains unknown property '{key}'.")
                if not isinstance(attachments.get("enabled"), bool):
                    errors.append(f"{attachment_path}.enabled must be a boolean.")
                max_files = attachments.get("max_files", 20)
                if isinstance(max_files, bool) or not isinstance(max_files, int) or not 1 <= max_files <= 100:
                    errors.append(f"{attachment_path}.max_files must be an integer between 1 and 100.")
                max_size = attachments.get("max_size_mb", 3)
                if isinstance(max_size, bool) or not isinstance(max_size, int) or not 1 <= max_size <= 4:
                    errors.append(f"{attachment_path}.max_size_mb must be an integer between 1 and 4.")
                allowed_types = attachments.get("allowed_types")
                if allowed_types is not None:
                    if not isinstance(allowed_types, list) or not allowed_types:
                        errors.append(f"{attachment_path}.allowed_types must be a non-empty array.")
                    else:
                        for type_index, content_type in enumerate(allowed_types):
                            if not isinstance(content_type, str) or not MIME_PATTERN.fullmatch(content_type):
                                errors.append(
                                    f"{attachment_path}.allowed_types[{type_index}] must be a lowercase MIME type or wildcard."
                                )
                        if len(allowed_types) != len(set(allowed_types)):
                            errors.append(f"{attachment_path}.allowed_types contains duplicates.")

        relationships = entity.get("relationships", [])
        if not isinstance(relationships, list):
            errors.append(f"{path}.relationships must be an array.")
            relationships = []
        relationship_keys: list[str] = []
        for relationship_index, relationship in enumerate(relationships):
            relationship_path = f"{path}.relationships[{relationship_index}]"
            if not isinstance(relationship, dict):
                errors.append(f"{relationship_path} must be an object.")
                continue
            if not is_identifier(relationship.get("key")):
                errors.append(f"{relationship_path}.key must be a snake_case identifier.")
            else:
                relationship_keys.append(relationship["key"])
            relation_type = relationship.get("type")
            if relation_type not in RELATIONSHIP_TYPES:
                errors.append(f"{relationship_path}.type is invalid.")
            if relation_type == "many_to_many":
                errors.append(f"{relationship_path}: many_to_many is reserved and not compiled in v0.")
            if relationship.get("on_delete", "restrict") not in DELETE_ACTIONS:
                errors.append(f"{relationship_path}.on_delete is invalid.")
            if relationship.get("required") and relationship.get("on_delete") == "set_null":
                errors.append(f"{relationship_path}: required relationships cannot use set_null.")
            if relation_type == "has_many" and relationship.get("required"):
                errors.append(f"{relationship_path}: has_many cannot be required.")
        for key in duplicates(relationship_keys):
            errors.append(f"Duplicate relationship key '{key}' in entity '{entity_key}'.")
        for key in sorted(set(relationship_keys) & field_key_set):
            errors.append(f"Field and relationship keys collide in entity '{entity_key}': {key}.")
        for key in relationship_keys:
            if f"{key}_id" in field_key_set:
                errors.append(
                    f"Field '{key}_id' collides with the generated foreign key in entity '{entity_key}'."
                )

        permissions = entity.get("permissions")
        if not isinstance(permissions, dict) or not permissions:
            errors.append(f"{path}.permissions must be a non-empty object.")
        else:
            for role, actions in permissions.items():
                if role not in role_keys:
                    errors.append(f"{path}.permissions references unknown role '{role}'.")
                if not isinstance(actions, list) or any(action not in ACTIONS for action in actions):
                    errors.append(f"{path}.permissions.{role} contains unsupported actions.")
                elif len(actions) != len(set(actions)):
                    errors.append(f"{path}.permissions.{role} contains duplicate actions.")

    for key in duplicates(entity_keys):
        errors.append(f"Duplicate entity key: {key}.")
    entity_key_set = set(entity_keys)

    for entity_index, entity in enumerate(entities):
        if not isinstance(entity, dict):
            continue
        for relationship_index, relationship in enumerate(entity.get("relationships", [])):
            if isinstance(relationship, dict) and relationship.get("target") not in entity_key_set:
                errors.append(
                    f"entities[{entity_index}].relationships[{relationship_index}] targets unknown entity "
                    f"'{relationship.get('target')}'."
                )

    views = spec.get("views")
    view_keys: list[str] = []
    if not isinstance(views, list):
        errors.append("views must be an array.")
        views = []
    for view_index, view in enumerate(views):
        path = f"views[{view_index}]"
        if not isinstance(view, dict):
            errors.append(f"{path} must be an object.")
            continue
        allowed_view_keys = {
            "key", "label", "type", "entity", "navigation", "fields", "default_sort",
            "page_size", "bulk_edit_fields", "group_by", "allow_move", "date_field",
            "end_date_field", "allow_reschedule", "widgets",
        }
        for key in sorted(set(view) - allowed_view_keys):
            errors.append(f"Unknown property at {path}: {key}.")
        if not is_identifier(view.get("key")):
            errors.append(f"{path}.key must be a snake_case identifier.")
        else:
            view_keys.append(view["key"])
        if not required_string(view.get("label")):
            errors.append(f"{path}.label must be a non-empty string.")
        view_type = view.get("type")
        if view_type not in VIEW_TYPES:
            errors.append(f"{path}.type is invalid.")
        entity_key = view.get("entity")
        if view_type != "dashboard" and entity_key not in entity_key_set:
            errors.append(f"{path}.entity must reference a known entity.")
        fields = view.get("fields", [])
        if not isinstance(fields, list):
            errors.append(f"{path}.fields must be an array.")
            fields = []
        if entity_key in entity_fields:
            for field in fields:
                if field not in entity_fields[entity_key]:
                    errors.append(f"{path}.fields references unknown field '{field}'.")
            default_sort = view.get("default_sort")
            if default_sort is not None:
                if not isinstance(default_sort, dict):
                    errors.append(f"{path}.default_sort must be an object.")
                else:
                    if default_sort.get("field") not in entity_fields[entity_key] | SYSTEM_FIELDS:
                        errors.append(f"{path}.default_sort.field references an unknown sortable field.")
                    if default_sort.get("direction") not in {"asc", "desc"}:
                        errors.append(f"{path}.default_sort.direction must be 'asc' or 'desc'.")
            page_size = view.get("page_size", 50)
            if isinstance(page_size, bool) or not isinstance(page_size, int) or not 10 <= page_size <= 100:
                errors.append(f"{path}.page_size must be an integer between 10 and 100.")

        bulk_edit_fields = view.get("bulk_edit_fields")
        if view_type == "table":
            if bulk_edit_fields is not None:
                if not isinstance(bulk_edit_fields, list):
                    errors.append(f"{path}.bulk_edit_fields must be an array.")
                elif entity_key in entity_field_specs:
                    string_fields = [field for field in bulk_edit_fields if isinstance(field, str)]
                    if len(string_fields) != len(set(string_fields)):
                        errors.append(f"{path}.bulk_edit_fields must not contain duplicates.")
                    for field_key in bulk_edit_fields:
                        if not isinstance(field_key, str):
                            errors.append(f"{path}.bulk_edit_fields entries must be field identifiers.")
                            continue
                        field = entity_field_specs[entity_key].get(field_key)
                        if not field or field.get("type") not in {"enum", "boolean"}:
                            errors.append(
                                f"{path}.bulk_edit_fields must reference enum or boolean fields on the view entity."
                            )
        elif bulk_edit_fields is not None:
            errors.append(f"{path}.bulk_edit_fields is only valid for table views.")

        if view_type == "kanban" and entity_key in entity_field_specs:
            group_by = view.get("group_by")
            group_field = entity_field_specs[entity_key].get(group_by)
            if not group_field or group_field.get("type") != "enum":
                errors.append(f"{path}.group_by must reference an enum field on the view entity.")
            if not isinstance(view.get("allow_move", False), bool):
                errors.append(f"{path}.allow_move must be a boolean.")
        elif "allow_move" in view:
            errors.append(f"{path}.allow_move is only valid for kanban views.")
        if view_type == "calendar" and entity_key in entity_field_specs:
            date_field = entity_field_specs[entity_key].get(view.get("date_field"))
            if not date_field or date_field.get("type") not in {"date", "datetime"}:
                errors.append(f"{path}.date_field must reference a date or datetime field.")
            if "end_date_field" in view:
                end_field = entity_field_specs[entity_key].get(view.get("end_date_field"))
                if not end_field or end_field.get("type") not in {"date", "datetime"}:
                    errors.append(f"{path}.end_date_field must reference a date or datetime field.")
            if not isinstance(view.get("allow_reschedule", False), bool):
                errors.append(f"{path}.allow_reschedule must be a boolean.")
        elif "allow_reschedule" in view:
            errors.append(f"{path}.allow_reschedule is only valid for calendar views.")
        if view_type == "dashboard":
            widgets = view.get("widgets")
            if not isinstance(widgets, list) or not widgets:
                errors.append(f"{path}.widgets must be a non-empty array for dashboard views.")
                widgets = []
            widget_keys: list[str] = []
            for widget_index, widget in enumerate(widgets):
                widget_path = f"{path}.widgets[{widget_index}]"
                if not isinstance(widget, dict):
                    errors.append(f"{widget_path} must be an object.")
                    continue
                if not is_identifier(widget.get("key")):
                    errors.append(f"{widget_path}.key must be a snake_case identifier.")
                else:
                    widget_keys.append(widget["key"])
                if not required_string(widget.get("label")):
                    errors.append(f"{widget_path}.label must be a non-empty string.")
                widget_type = widget.get("type")
                if widget_type not in {"metric", "breakdown", "recent"}:
                    errors.append(f"{widget_path}.type is invalid.")
                widget_entity = widget.get("entity")
                if widget_entity not in entity_key_set:
                    errors.append(f"{widget_path}.entity must reference a known entity.")
                    continue
                widget_fields = entity_field_specs[widget_entity]
                if widget_type == "metric":
                    aggregate = widget.get("aggregate", "count")
                    if aggregate not in {"count", "sum", "avg"}:
                        errors.append(f"{widget_path}.aggregate is invalid.")
                    if aggregate in {"sum", "avg"}:
                        metric_field = widget_fields.get(widget.get("field"))
                        if not metric_field or metric_field.get("type") not in {"integer", "decimal"}:
                            errors.append(f"{widget_path}.field must reference a numeric field for {aggregate}.")
                elif widget_type == "breakdown":
                    group_field = widget_fields.get(widget.get("group_by"))
                    if not group_field or group_field.get("type") not in {"enum", "boolean"}:
                        errors.append(f"{widget_path}.group_by must reference an enum or boolean field.")
                elif widget_type == "recent":
                    recent_fields = widget.get("fields", [])
                    if not isinstance(recent_fields, list) or not recent_fields:
                        errors.append(f"{widget_path}.fields must be a non-empty array.")
                    else:
                        for field in recent_fields:
                            if field not in widget_fields:
                                errors.append(f"{widget_path}.fields references unknown field '{field}'.")
                    limit = widget.get("limit", 5)
                    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 20:
                        errors.append(f"{widget_path}.limit must be an integer between 1 and 20.")
            for key in duplicates(widget_keys):
                errors.append(f"Duplicate dashboard widget key '{key}' at {path}.")
        elif "widgets" in view:
            errors.append(f"{path}.widgets is only valid for dashboard views.")
    for key in duplicates(view_keys):
        errors.append(f"Duplicate view key: {key}.")

    decisions = spec.get("decisions", [])
    if not isinstance(decisions, list):
        errors.append("decisions must be an array.")
    else:
        for index, decision in enumerate(decisions):
            path = f"decisions[{index}]"
            if not isinstance(decision, dict):
                errors.append(f"{path} must be an object.")
                continue
            if decision.get("status") not in DECISION_STATUSES:
                errors.append(f"{path}.status is invalid.")
            if not is_identifier(decision.get("topic")):
                errors.append(f"{path}.topic must be a snake_case identifier.")
            if not required_string(decision.get("statement")):
                errors.append(f"{path}.statement must be a non-empty string.")

    rules = spec.get("rules", [])
    if not isinstance(rules, list):
        errors.append("rules must be an array.")
    else:
        rule_keys: list[str] = []
        entity_map = {
            entity["key"]: entity
            for entity in entities
            if isinstance(entity, dict) and is_identifier(entity.get("key"))
        }
        for index, rule in enumerate(rules):
            path = f"rules[{index}]"
            if not isinstance(rule, dict):
                errors.append(f"{path} must be an object.")
                continue
            allowed_rule_keys = {"key", "label", "description", "enabled", "priority", "when", "if", "then"}
            for key in sorted(set(rule) - allowed_rule_keys):
                errors.append(f"{path} contains unknown property '{key}'.")
            if not is_identifier(rule.get("key")):
                errors.append(f"{path}.key must be a snake_case identifier.")
            else:
                rule_keys.append(rule["key"])
            if not required_string(rule.get("label")):
                errors.append(f"{path}.label must be a non-empty string.")
            if "enabled" in rule and not isinstance(rule["enabled"], bool):
                errors.append(f"{path}.enabled must be a boolean.")
            priority = rule.get("priority", 100)
            if not isinstance(priority, int) or isinstance(priority, bool) or not 0 <= priority <= 1000:
                errors.append(f"{path}.priority must be an integer between 0 and 1000.")

            when = rule.get("when")
            entity_key = None
            event = None
            if not isinstance(when, dict):
                errors.append(f"{path}.when must be an object.")
            else:
                for key in sorted(set(when) - {"entity", "event"}):
                    errors.append(f"{path}.when contains unknown property '{key}'.")
                entity_key = when.get("entity")
                event = when.get("event")
                if entity_key not in entity_map:
                    errors.append(f"{path}.when.entity references unknown entity '{entity_key}'.")
                if event not in RULE_EVENTS:
                    errors.append(f"{path}.when.event is invalid.")
            fields = rule_field_map(entity_map[entity_key]) if entity_key in entity_map else {}
            node_count = validate_rule_condition(rule.get("if"), f"{path}.if", fields, errors)
            if node_count > 50:
                errors.append(f"{path}.if exceeds the maximum of 50 condition nodes.")

            actions = rule.get("then")
            if not isinstance(actions, list) or not actions:
                errors.append(f"{path}.then must be a non-empty array.")
                continue
            if len(actions) > 20:
                errors.append(f"{path}.then exceeds the maximum of 20 actions.")
            for action_index, action in enumerate(actions):
                action_path = f"{path}.then[{action_index}]"
                if not isinstance(action, dict):
                    errors.append(f"{action_path} must be an object.")
                    continue
                action_type = action.get("action")
                if action_type == "set":
                    for key in sorted(set(action) - {"action", "field", "value"}):
                        errors.append(f"{action_path} contains unknown property '{key}'.")
                    field_key = action.get("field")
                    if field_key not in fields:
                        errors.append(f"{action_path}.field references unknown field '{field_key}'.")
                    elif "value" not in action:
                        errors.append(f"{action_path}.value is required.")
                    else:
                        validate_rule_value(action["value"], f"{action_path}.value", fields[field_key], fields, errors, assignment=True)
                    if event == "before_delete":
                        errors.append(f"{action_path}: before_delete rules may only block.")
                elif action_type == "block":
                    for key in sorted(set(action) - {"action", "message"}):
                        errors.append(f"{action_path} contains unknown property '{key}'.")
                    if not required_string(action.get("message")):
                        errors.append(f"{action_path}.message must be a non-empty string.")
                else:
                    errors.append(f"{action_path}.action must be 'set' or 'block'.")
        for key in duplicates(rule_keys):
            errors.append(f"Duplicate rule key: {key}.")
    return errors


def sql_identifier(value: str) -> str:
    if not is_identifier(value):
        raise SpecError(f"Unsafe SQL identifier: {value!r}")
    return f'"{value}"'


def database_object_name(prefix: str, *parts: str) -> str:
    raw = "_".join((prefix, *parts))
    if len(raw) <= 63:
        return raw
    digest = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]
    return f"{raw[:52]}_{digest}"


def sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def sql_default(field: dict[str, Any]) -> str | None:
    if "default" not in field:
        return None
    value = field["default"]
    field_type = field["type"]
    if value is None:
        return "NULL"
    if field_type == "boolean" and isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if field_type in {"integer", "decimal"} and isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if field_type in {"file", "json"}:
        return f"{sql_string(json.dumps(value, ensure_ascii=False))}::jsonb"
    if isinstance(value, str):
        return sql_string(value)
    raise SpecError(f"Unsupported default for field {field['key']!r}.")


def sql_type(field: dict[str, Any]) -> str:
    return {
        "text": "text",
        "long_text": "text",
        "integer": "bigint",
        "decimal": "numeric(18,4)",
        "boolean": "boolean",
        "date": "date",
        "datetime": "timestamptz",
        "email": "text",
        "url": "text",
        "enum": "text",
        "file": "jsonb",
        "json": "jsonb",
    }[field["type"]]


def compile_sql(spec: dict[str, Any]) -> str:
    lines = [
        "-- GENERATED BY RIEL APP FACTORY. CREATE NEW MIGRATIONS; DO NOT EDIT AFTER DEPLOYMENT.",
        "BEGIN;",
        "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
        "",
        "CREATE TABLE IF NOT EXISTS app_role (",
        "  key text PRIMARY KEY,",
        "  label text NOT NULL",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS app_user (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  auth_subject text NOT NULL UNIQUE,",
        "  email text NOT NULL UNIQUE,",
        "  display_name text NOT NULL,",
        "  role_key text NOT NULL REFERENCES app_role(key) ON DELETE RESTRICT,",
        "  active boolean NOT NULL DEFAULT TRUE,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  updated_at timestamptz NOT NULL DEFAULT now()",
        ");",
        "",
        "CREATE TABLE IF NOT EXISTS app_audit_log (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  actor_id uuid REFERENCES app_user(id) ON DELETE SET NULL,",
        "  entity_key text NOT NULL,",
        "  record_id uuid,",
        "  action text NOT NULL,",
        "  changes jsonb,",
        "  created_at timestamptz NOT NULL DEFAULT now()",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS app_audit_log_created_at_idx ON app_audit_log (created_at DESC);",
        "CREATE INDEX IF NOT EXISTS app_audit_log_entity_record_idx ON app_audit_log (entity_key, record_id);",
        "CREATE INDEX IF NOT EXISTS app_audit_log_actor_idx ON app_audit_log (actor_id);",
        "",
        "CREATE TABLE IF NOT EXISTS app_import_batch (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  actor_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,",
        "  entity_key text NOT NULL,",
        "  file_name text NOT NULL,",
        "  rows jsonb NOT NULL,",
        "  row_count integer NOT NULL CHECK (row_count > 0 AND row_count <= 1000),",
        "  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'completed')) ,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),",
        "  completed_at timestamptz",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS app_import_batch_actor_idx ON app_import_batch (actor_id, status);",
        "CREATE INDEX IF NOT EXISTS app_import_batch_expiry_idx ON app_import_batch (expires_at);",
        "",
        "CREATE TABLE IF NOT EXISTS app_attachment (",
        "  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),",
        "  entity_key text NOT NULL,",
        "  record_id uuid NOT NULL,",
        "  original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 255),",
        "  content_type text NOT NULL CHECK (length(content_type) BETWEEN 3 AND 127),",
        "  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304),",
        "  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),",
        "  content bytea NOT NULL,",
        "  created_by uuid REFERENCES app_user(id) ON DELETE SET NULL,",
        "  created_at timestamptz NOT NULL DEFAULT now(),",
        "  CHECK (octet_length(content) = size_bytes)",
        ");",
        "",
        "CREATE INDEX IF NOT EXISTS app_attachment_record_idx ON app_attachment (entity_key, record_id, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS app_attachment_creator_idx ON app_attachment (created_by);",
        "",
        "CREATE OR REPLACE FUNCTION app_set_updated_at() RETURNS trigger AS $$",
        "BEGIN",
        "  NEW.updated_at = now();",
        "  RETURN NEW;",
        "END;",
        "$$ LANGUAGE plpgsql;",
        "",
        "DROP TRIGGER IF EXISTS app_user_set_updated_at ON app_user;",
        "CREATE TRIGGER app_user_set_updated_at BEFORE UPDATE ON app_user",
        "  FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();",
        "",
    ]
    for role in spec["roles"]:
        lines.append(
            "INSERT INTO app_role (key, label) VALUES "
            f"({sql_string(role['key'])}, {sql_string(role['label'])}) "
            "ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;"
        )
    lines.append("")

    for entity in spec["entities"]:
        columns = [
            "  id uuid PRIMARY KEY DEFAULT gen_random_uuid()",
            "  created_at timestamptz NOT NULL DEFAULT now()",
            "  updated_at timestamptz NOT NULL DEFAULT now()",
        ]
        constraints: list[str] = []
        for field in entity["fields"]:
            parts = [f"  {sql_identifier(field['key'])} {sql_type(field)}"]
            if field.get("required"):
                parts.append("NOT NULL")
            default_value = sql_default(field)
            if default_value is not None:
                parts.append(f"DEFAULT {default_value}")
            if field.get("unique"):
                parts.append("UNIQUE")
            columns.append(" ".join(parts))
            if field["type"] == "enum":
                values = ", ".join(sql_string(option["key"]) for option in field["options"])
                constraints.append(
                    f"  CONSTRAINT {sql_identifier(database_object_name('ck', entity['key'], field['key']))} "
                    f"CHECK ({sql_identifier(field['key'])} IN ({values}))"
                )
        for relationship in entity.get("relationships", []):
            if relationship["type"] != "belongs_to":
                continue
            parts = [f"  {sql_identifier(relationship['key'] + '_id')} uuid"]
            if relationship.get("required"):
                parts.append("NOT NULL")
            columns.append(" ".join(parts))
        body = columns + constraints
        lines.extend(
            [
                f"CREATE TABLE {sql_identifier(entity['key'])} (",
                ",\n".join(body),
                ");",
                f"CREATE TRIGGER {sql_identifier(database_object_name('trg', entity['key'], 'updated_at'))}",
                f"  BEFORE UPDATE ON {sql_identifier(entity['key'])}",
                "  FOR EACH ROW EXECUTE FUNCTION app_set_updated_at();",
                "",
            ]
        )

    for entity in spec["entities"]:
        for relationship in entity.get("relationships", []):
            if relationship["type"] != "belongs_to":
                continue
            on_delete = {
                "restrict": "RESTRICT",
                "cascade": "CASCADE",
                "set_null": "SET NULL",
            }[relationship.get("on_delete", "restrict")]
            constraint = database_object_name("fk", entity["key"], relationship["key"])
            lines.extend(
                [
                    f"ALTER TABLE {sql_identifier(entity['key'])}",
                    f"  ADD CONSTRAINT {sql_identifier(constraint)}",
                    f"  FOREIGN KEY ({sql_identifier(relationship['key'] + '_id')})",
                    f"  REFERENCES {sql_identifier(relationship['target'])}(id) ON DELETE {on_delete};",
                    f"CREATE INDEX {sql_identifier(database_object_name('ix', entity['key'], relationship['key']))}",
                    f"  ON {sql_identifier(entity['key'])} ({sql_identifier(relationship['key'] + '_id')});",
                    "",
                ]
            )
        for field in entity["fields"]:
            if field.get("searchable"):
                index_name = database_object_name("ix", entity["key"], field["key"])
                lines.extend(
                    [
                        f"CREATE INDEX {sql_identifier(index_name)}",
                        f"  ON {sql_identifier(entity['key'])} ({sql_identifier(field['key'])});",
                        "",
                    ]
                )
    lines.extend(["COMMIT;", ""])
    return "\n".join(lines)


def typescript_literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def compile_registry(spec: dict[str, Any]) -> str:
    entity_keys = " | ".join(json.dumps(entity["key"]) for entity in spec["entities"])
    view_keys = " | ".join(json.dumps(view["key"]) for view in spec["views"]) or "never"
    return (
        "/* GENERATED BY RIEL APP FACTORY. DO NOT ADD CLIENT FEATURES HERE. */\n"
        f"export const appSpec = {typescript_literal(spec)} as const;\n\n"
        f"export type EntityKey = {entity_keys};\n"
        f"export type ViewKey = {view_keys};\n\n"
        "export const entityRegistry = Object.fromEntries(\n"
        "  appSpec.entities.map((entity) => [entity.key, entity]),\n"
        ") as Record<EntityKey, (typeof appSpec.entities)[number]>;\n"
    )


def compile_navigation(spec: dict[str, Any]) -> str:
    navigation = [view for view in spec["views"] if view.get("navigation")]
    return (
        "/* GENERATED BY RIEL APP FACTORY. */\n"
        f"export const generatedNavigation = {typescript_literal(navigation)} as const;\n"
    )


def compile_permissions(spec: dict[str, Any]) -> str:
    matrix = {entity["key"]: entity["permissions"] for entity in spec["entities"]}
    return (
        "/* GENERATED BY RIEL APP FACTORY. ENFORCE THIS MATRIX SERVER-SIDE. */\n"
        f"export const generatedPermissions = {typescript_literal(matrix)} as const;\n"
    )


def compile_report(spec: dict[str, Any]) -> str:
    decisions = spec.get("decisions", [])
    assumptions = [item for item in decisions if item["status"] == "assumption"]
    unresolved = [item for item in decisions if item["status"] == "unresolved"]
    file_count = sum(
        1 for entity in spec["entities"] for field in entity["fields"] if field["type"] == "file"
    )
    attachment_entities = [
        entity for entity in spec["entities"] if entity.get("attachments", {}).get("enabled")
    ]
    lines = [
        f"# Build report: {spec['app']['name']}",
        "",
        "## Result",
        "",
        "Local-preview application generated successfully. This output is not production-ready by itself.",
        "",
        "## Inventory",
        "",
        f"- Entities: {len(spec['entities'])}",
        f"- Roles: {len(spec['roles'])}",
        f"- Views: {len(spec['views'])}",
        f"- Executable deterministic rules: {len(spec.get('rules', []))}",
        f"- File fields: {file_count}",
        f"- Entities with record attachments: {len(attachment_entities)}",
        "",
        "## Security included",
        "",
        "- The generated permission matrix is enforced server-side on record pages and mutations.",
        "- Local role sessions are HTTP-only and accepted only outside production.",
        "- Production fails closed through a client-owned authentication adapter boundary.",
        "- Create, update, and delete operations write an audit event in the same database transaction.",
        "- CSV/XLSX imports are size-limited, prevalidated, staged per user, committed atomically, and audited per record.",
        "- AppSpec rules use a validated expression tree with only deterministic set/block actions; arbitrary code and side effects are rejected.",
        "- Record attachments inherit entity permissions, are size/type limited, stored transactionally in PostgreSQL, and audited.",
        "- Named table, kanban, calendar, and dashboard views execute only validated metadata and identifiers.",
        "- Pagination and opt-in bulk, kanban, and calendar mutations reuse server permissions, deterministic rules, transactions, and audit.",
        "- The persistent application assistant exposes only bounded read tools and checks the current user's entity permissions on every call.",
        "",
        "## Production gates",
        "",
        "- Select and implement the production authentication adapter in `src/features/auth/adapter.ts`.",
        "- Provision active `app_user` records and map each external identity subject to an application role.",
        "- Add provider-specific end-to-end authentication, sign-out, and authorization tests.",
        "- Define audit-log retention, export, and access-review policy for the client.",
        "- Schedule deletion of expired import-preview batches and define the client's import retention policy.",
        "- Configure the AI provider secret, model allowlist, per-user budgets, retention policy, and provider data terms.",
        "- Configure deployment, secrets, backups, logging, and monitoring per client.",
    ]
    if spec.get("rules"):
        lines.append("- Review every rule and assumption with the client, and keep regression tests for each blocking or assignment path.")
    if file_count:
        lines.append("- Review whether legacy `file` fields should be migrated to universal record attachments.")
    if attachment_entities:
        lines.append("- Confirm allowed MIME types, maximum file count, retention, and backup policy with the client.")
        lines.append("- Use a reviewed direct-upload/object-storage adapter when files exceed 4 MB or database storage is unsuitable.")
    lines.extend(["", "## Local preview limitations", ""])
    lines.append("- Bulk editing is limited to explicitly configured enum/boolean fields and at most 100 selected records per atomic operation.")
    lines.append("- Kanban and calendar mutations are disabled unless the AppSpec explicitly enables them; richer scheduling semantics remain client features.")
    lines.append(
        "- Generic imports create new records only. Client-specific update, merge, or upsert behavior belongs in `src/features/`."
    )
    lines.append(
        "- The bundled assistant is read-only. AI writes, approvals, connectors, schedules, email, webhooks, and external side effects require reviewed client features."
    )
    lines.extend(["", "## Assumptions", ""])
    lines.extend(
        [f"- **{item['topic']}**: {item['statement']}" for item in assumptions]
        or ["- None recorded."]
    )
    lines.extend(["", "## Unresolved decisions", ""])
    lines.extend(
        [f"- **{item['topic']}**: {item['statement']}" for item in unresolved]
        or ["- None recorded."]
    )
    lines.extend(
        [
            "",
            "## Ownership boundary",
            "",
            "Generated structure lives in `src/generated/` and `database/generated/`. ",
            "Client behavior belongs in `src/features/` and `database/custom/`.",
            "",
        ]
    )
    return "\n".join(lines)


FEATURE_GUIDE = """# Client features

This directory is never owned by the generator. Add client-specific calculations,
integrations, workflows, reports, AI tools, and bespoke UI here. Register each feature
through an explicit adapter; do not edit files in `src/generated/`.

`ai/` contains the neutral read-only application assistant. Extend its tool registry
through reviewed feature adapters; never bypass application permissions with direct SQL.

`auth/adapter.ts` is the production identity boundary. Replace its fail-closed stub
with a reviewed provider integration and keep application roles in PostgreSQL.
"""


CUSTOM_DB_GUIDE = """# Custom database changes

Put client-specific migrations here. Never edit an applied migration in
`database/generated/`; add a new reviewed migration with an explicit dependency.
"""


def ensure_safe_output(output: Path) -> None:
    if output.exists() and any(output.iterdir()):
        raise SpecError(f"Output directory is not empty: {output}")
    output.mkdir(parents=True, exist_ok=True)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")


def copy_runtime(spec: dict[str, Any], output: Path) -> list[Path]:
    source = Path(__file__).resolve().parent.parent / "assets" / "runtime-nextjs"
    if not source.is_dir():
        raise SpecError(f"Runtime template not found: {source}")
    shutil.copytree(
        source,
        output,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("node_modules", ".next"),
    )
    replacements = {
        "__APP_KEY__": spec["app"]["key"].replace("_", "-"),
        "__PRIMARY__": spec["app"].get("theme", {}).get("primary", "#6757E8"),
        "__SURFACE__": spec["app"].get("theme", {}).get("surface", "#151820"),
    }
    copied: list[Path] = []
    for path in output.rglob("*"):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            copied.append(path)
            continue
        for token, value in replacements.items():
            content = content.replace(token, value)
        write_text(path, content)
        copied.append(path)
    return copied


def scaffold(spec: dict[str, Any], output: Path) -> list[Path]:
    ensure_safe_output(output)
    written = copy_runtime(spec, output)
    files: dict[str, str] = {
        "app-spec.json": json.dumps(spec, ensure_ascii=False, indent=2) + "\n",
        "database/generated/001_initial.sql": compile_sql(spec),
        "src/generated/app-spec.ts": compile_registry(spec),
        "src/generated/navigation.ts": compile_navigation(spec),
        "src/generated/permissions.ts": compile_permissions(spec),
        "src/features/EXTENSIONS.md": FEATURE_GUIDE,
        "src/components/custom/EXTENSIONS.md": FEATURE_GUIDE,
        "database/custom/EXTENSIONS.md": CUSTOM_DB_GUIDE,
        "BUILD_REPORT.md": compile_report(spec),
    }
    for relative_path, content in files.items():
        destination = output / relative_path
        write_text(destination, content)
        written.append(destination)
    return written


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", required=True, type=Path, help="Path to app-spec.json")
    parser.add_argument("--output", required=True, type=Path, help="New or empty output directory")
    parser.add_argument("--validate-only", action="store_true", help="Validate without writing files")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        spec = json.loads(args.spec.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Spec not found: {args.spec}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as error:
        print(f"Invalid JSON at line {error.lineno}, column {error.colno}: {error.msg}", file=sys.stderr)
        return 2

    errors = validate_spec(spec)
    if errors:
        print("AppSpec validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 2
    if args.validate_only:
        print(f"AppSpec valid: {spec['app']['name']}")
        return 0
    try:
        written = scaffold(spec, args.output.resolve())
    except SpecError as error:
        print(str(error), file=sys.stderr)
        return 2
    print(f"Generated foundation: {spec['app']['name']}")
    print(f"Output: {args.output.resolve()}")
    print(f"Files: {len(written)}")
    print("Status: local preview runtime; review BUILD_REPORT.md before production")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
