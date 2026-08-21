#!/usr/bin/env python3
"""Tests for safe incremental AppSpec evolution."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from evolve_app import apply_evolution, compile_migration, plan_evolution
from scaffold_app import scaffold, validate_spec


EXAMPLE = Path(__file__).resolve().parent.parent / "references" / "example-maintenance.app-spec.json"


class EvolutionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def test_additive_field_and_rule_are_safe(self) -> None:
        proposed = copy.deepcopy(self.spec)
        equipment = next(entity for entity in proposed["entities"] if entity["key"] == "equipment")
        equipment["fields"].append(
            {
                "key": "priority",
                "label": "Prioridad",
                "type": "enum",
                "default": "medium",
                "options": [
                    {"key": "low", "label": "Baja"},
                    {"key": "medium", "label": "Media"},
                    {"key": "high", "label": "Alta"},
                ],
            }
        )
        proposed["rules"].append(
            {
                "key": "protect_high_priority",
                "label": "Proteger prioridad alta",
                "when": {"entity": "equipment", "event": "before_delete"},
                "if": {"field": "priority", "operator": "eq", "value": "high"},
                "then": [{"action": "block", "message": "Revisá el equipo antes de eliminarlo."}],
            }
        )
        self.assertEqual(validate_spec(proposed), [])
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(plan.safe_to_apply)
        self.assertFalse(plan.blocked)
        sql = "\n".join(plan.sql)
        self.assertIn('ALTER TABLE "equipment" ADD COLUMN "priority" text DEFAULT', sql)
        self.assertIn('ADD CONSTRAINT "ck_equipment_priority"', sql)
        self.assertTrue(any("Rule added" in change for change in plan.changes))

    def test_new_entity_compiles_table_indexes_and_foreign_key(self) -> None:
        proposed = copy.deepcopy(self.spec)
        proposed["entities"].append(
            {
                "key": "inspection",
                "label": "Inspección",
                "label_plural": "Inspecciones",
                "title_field": "summary",
                "fields": [
                    {"key": "summary", "label": "Resumen", "type": "text", "required": True, "searchable": True},
                    {"key": "performed_on", "label": "Fecha", "type": "date"},
                ],
                "relationships": [
                    {
                        "key": "equipment",
                        "label": "Equipo",
                        "type": "belongs_to",
                        "target": "equipment",
                        "required": True,
                        "on_delete": "restrict",
                    }
                ],
                "permissions": {
                    "admin": ["list", "read", "create", "update", "delete"],
                    "supervisor": ["list", "read", "create", "update"],
                    "technician": ["list", "read", "create"],
                },
            }
        )
        proposed["views"].append(
            {
                "key": "inspection_list",
                "label": "Inspecciones",
                "type": "table",
                "entity": "inspection",
                "navigation": True,
                "fields": ["summary", "performed_on"],
            }
        )
        self.assertEqual(validate_spec(proposed), [])
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(plan.safe_to_apply)
        sql = "\n".join(plan.sql)
        self.assertIn('CREATE TABLE "inspection"', sql)
        self.assertIn('FOREIGN KEY ("equipment_id")', sql)
        self.assertIn('CREATE INDEX "ix_inspection_summary"', sql)

    def test_removal_and_type_change_are_blocked(self) -> None:
        proposed = copy.deepcopy(self.spec)
        equipment = next(entity for entity in proposed["entities"] if entity["key"] == "equipment")
        equipment["fields"] = [field for field in equipment["fields"] if field["key"] != "commissioned_on"]
        serial = next(field for field in equipment["fields"] if field["key"] == "serial_number")
        serial["type"] = "integer"
        plan = plan_evolution(self.spec, proposed)
        self.assertFalse(plan.safe_to_apply)
        self.assertTrue(any("Removing or renaming a field" in item for item in plan.blocked))
        self.assertTrue(any("Field type change" in item for item in plan.blocked))

    def test_required_addition_without_default_is_blocked(self) -> None:
        proposed = copy.deepcopy(self.spec)
        equipment = next(entity for entity in proposed["entities"] if entity["key"] == "equipment")
        equipment["fields"].append(
            {"key": "owner", "label": "Responsable", "type": "text", "required": True}
        )
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(any("needs a default or backfill plan" in item for item in plan.blocked))

        proposed_with_null = copy.deepcopy(self.spec)
        equipment_with_null = next(
            entity for entity in proposed_with_null["entities"] if entity["key"] == "equipment"
        )
        equipment_with_null["fields"].append(
            {"key": "location", "label": "Ubicación", "type": "text", "required": True, "default": None}
        )
        null_plan = plan_evolution(self.spec, proposed_with_null)
        self.assertTrue(any("needs a default or backfill plan" in item for item in null_plan.blocked))

    def test_has_many_metadata_does_not_create_a_column(self) -> None:
        proposed = copy.deepcopy(self.spec)
        equipment = next(entity for entity in proposed["entities"] if entity["key"] == "equipment")
        equipment["relationships"].append(
            {"key": "inspections", "label": "Inspecciones", "type": "has_many", "target": "work_order"}
        )
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(plan.safe_to_apply)
        self.assertFalse(any("inspections_id" in statement for statement in plan.sql))
        self.assertTrue(any("Inverse relationship metadata added" in change for change in plan.changes))

    def test_enum_expansion_is_safe_but_removal_is_blocked(self) -> None:
        expanded = copy.deepcopy(self.spec)
        status = next(
            field
            for entity in expanded["entities"]
            if entity["key"] == "equipment"
            for field in entity["fields"]
            if field["key"] == "status"
        )
        status["options"].append({"key": "reserved", "label": "Reservado"})
        expansion = plan_evolution(self.spec, expanded)
        self.assertTrue(expansion.safe_to_apply)
        self.assertIn('DROP CONSTRAINT "ck_equipment_status"', "\n".join(expansion.sql))

        reduced = copy.deepcopy(self.spec)
        reduced_status = next(
            field
            for entity in reduced["entities"]
            if entity["key"] == "equipment"
            for field in entity["fields"]
            if field["key"] == "status"
        )
        reduced_status["options"] = reduced_status["options"][:-1]
        reduction = plan_evolution(self.spec, reduced)
        self.assertTrue(any("Removing enum values" in item for item in reduction.blocked))

    def test_apply_preserves_extensions_and_creates_immutable_migration(self) -> None:
        proposed = copy.deepcopy(self.spec)
        work_order = next(entity for entity in proposed["entities"] if entity["key"] == "work_order")
        work_order["fields"].append(
            {"key": "estimated_hours", "label": "Horas estimadas", "type": "decimal"}
        )
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(plan.safe_to_apply)

        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "project"
            scaffold(self.spec, project)
            initial_migration = project / "database/generated/001_initial.sql"
            initial_source = initial_migration.read_text(encoding="utf-8")
            extension = project / "src/features/client-owned.ts"
            extension.write_text("export const preserved = true;\n", encoding="utf-8")

            migration = apply_evolution(
                project,
                proposed,
                plan,
                "add_estimated_hours",
            )

            self.assertIsNotNone(migration)
            self.assertEqual(migration.name, "002_add_estimated_hours.sql")
            self.assertIn('ADD COLUMN "estimated_hours" numeric(18,4)', migration.read_text(encoding="utf-8"))
            self.assertEqual(initial_migration.read_text(encoding="utf-8"), initial_source)
            self.assertEqual(extension.read_text(encoding="utf-8"), "export const preserved = true;\n")
            current = json.loads((project / "app-spec.json").read_text(encoding="utf-8"))
            self.assertEqual(current, proposed)
            self.assertIn("estimated_hours", (project / "src/generated/app-spec.ts").read_text(encoding="utf-8"))
            self.assertTrue((project / "EVOLUTION_REPORT.md").is_file())

            unchanged = plan_evolution(current, proposed)
            self.assertFalse(unchanged.changed)

    def test_runtime_only_change_does_not_create_migration(self) -> None:
        proposed = copy.deepcopy(self.spec)
        proposed["views"][0]["label"] = "Inventario"
        proposed["rules"][0]["label"] = "Informe obligatorio al completar"
        plan = plan_evolution(self.spec, proposed)
        self.assertTrue(plan.safe_to_apply)
        self.assertFalse(plan.sql)

        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary) / "project"
            scaffold(self.spec, project)
            migration = apply_evolution(project, proposed, plan, "runtime_only")
            self.assertIsNone(migration)
            migrations = sorted((project / "database/generated").glob("*.sql"))
            self.assertEqual([path.name for path in migrations], ["001_initial.sql"])

    def test_new_entity_is_created_with_row_level_security(self) -> None:
        # Una entidad que llega por evolucion no puede nacer mas abierta que las del
        # scaffold inicial.
        spec = copy.deepcopy(self.spec)
        spec["entities"].append({
            "key": "supplier", "label": "Proveedor", "label_plural": "Proveedores",
            "title_field": "name",
            "fields": [{"key": "name", "label": "Nombre", "type": "text", "required": True}],
            "permissions": {role["key"]: ["list", "read"] for role in spec["roles"]},
        })
        plan = plan_evolution(self.spec, spec)
        migration = compile_migration(plan)
        self.assertIn('ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;', migration)

    def test_migration_does_not_open_its_own_transaction(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][0]["fields"].append({"key": "extra", "label": "Extra", "type": "text"})
        migration = compile_migration(plan_evolution(self.spec, spec))
        self.assertNotIn("BEGIN;", migration)
        self.assertNotIn("COMMIT;", migration)


if __name__ == "__main__":
    unittest.main()
