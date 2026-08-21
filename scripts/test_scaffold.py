#!/usr/bin/env python3
"""Unit tests for AppSpec validation and deterministic compilation."""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scaffold_app import SpecError, compile_report, compile_sql, scaffold, validate_spec


EXAMPLE = Path(__file__).resolve().parent.parent / "references" / "example-maintenance.app-spec.json"


class ScaffoldTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = json.loads(EXAMPLE.read_text(encoding="utf-8"))

    def test_example_is_valid(self) -> None:
        self.assertEqual(validate_spec(self.spec), [])

    def test_duplicate_field_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][0]["fields"].append(copy.deepcopy(spec["entities"][0]["fields"][0]))
        errors = validate_spec(spec)
        self.assertTrue(any("Duplicate field key" in error for error in errors))

    def test_unknown_relationship_target_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][2]["relationships"][0]["target"] = "missing_entity"
        errors = validate_spec(spec)
        self.assertTrue(any("targets unknown entity" in error for error in errors))

    def test_many_to_many_is_explicitly_reserved(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][0]["relationships"][0]["type"] = "many_to_many"
        errors = validate_spec(spec)
        self.assertTrue(any("reserved and not compiled" in error for error in errors))

    def test_invalid_enum_default_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][0]["fields"][3]["default"] = "unknown"
        errors = validate_spec(spec)
        self.assertTrue(any("default must reference an enum option" in error for error in errors))

    def test_required_relationship_cannot_set_null(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][2]["relationships"][0]["on_delete"] = "set_null"
        errors = validate_spec(spec)
        self.assertTrue(any("required relationships cannot use set_null" in error for error in errors))

    def test_freeform_rule_expression_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rules"][0]["if"] = "status == 'completed'"
        errors = validate_spec(spec)
        self.assertTrue(any("must be a condition object" in error for error in errors))

    def test_rule_unknown_field_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rules"][0]["if"]["all"][0]["field"] = "missing_field"
        errors = validate_spec(spec)
        self.assertTrue(any("references unknown field 'missing_field'" in error for error in errors))

    def test_before_delete_rule_cannot_set_values(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["rules"][0]["when"]["event"] = "before_delete"
        spec["rules"][0]["then"] = [{"action": "set", "field": "status", "value": "pending"}]
        errors = validate_spec(spec)
        self.assertTrue(any("before_delete rules may only block" in error for error in errors))

    def test_attachment_limits_are_bounded(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][2]["attachments"]["max_size_mb"] = 25
        errors = validate_spec(spec)
        self.assertTrue(any("max_size_mb must be an integer between 1 and 4" in error for error in errors))

    def test_kanban_group_must_be_enum(self) -> None:
        spec = copy.deepcopy(self.spec)
        board = next(view for view in spec["views"] if view["type"] == "kanban")
        board["group_by"] = "scheduled_for"
        errors = validate_spec(spec)
        self.assertTrue(any("group_by must reference an enum field" in error for error in errors))

    def test_bulk_edit_fields_are_bounded_to_safe_types(self) -> None:
        spec = copy.deepcopy(self.spec)
        table = next(view for view in spec["views"] if view["type"] == "table")
        table["bulk_edit_fields"] = ["name"]
        errors = validate_spec(spec)
        self.assertTrue(any("must reference enum or boolean fields" in error for error in errors))

    def test_bulk_edit_fields_reject_non_identifiers(self) -> None:
        spec = copy.deepcopy(self.spec)
        table = next(view for view in spec["views"] if view["type"] == "table")
        table["bulk_edit_fields"] = [{"field": "status"}]
        errors = validate_spec(spec)
        self.assertTrue(any("entries must be field identifiers" in error for error in errors))

    def test_unknown_view_property_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["views"][0]["execute_sql"] = "SELECT 1"
        errors = validate_spec(spec)
        self.assertTrue(any("Unknown property at views[0]: execute_sql" in error for error in errors))

    def test_operational_flags_are_type_specific(self) -> None:
        spec = copy.deepcopy(self.spec)
        table = next(view for view in spec["views"] if view["type"] == "table")
        table["allow_move"] = True
        errors = validate_spec(spec)
        self.assertTrue(any("allow_move is only valid for kanban" in error for error in errors))

    def test_operational_flags_must_be_boolean(self) -> None:
        spec = copy.deepcopy(self.spec)
        board = next(view for view in spec["views"] if view["type"] == "kanban")
        board["allow_move"] = "yes"
        calendar = next(view for view in spec["views"] if view["type"] == "calendar")
        calendar["allow_reschedule"] = 1
        errors = validate_spec(spec)
        self.assertTrue(any("allow_move must be a boolean" in error for error in errors))
        self.assertTrue(any("allow_reschedule must be a boolean" in error for error in errors))

    def test_dashboard_sum_requires_numeric_field(self) -> None:
        spec = copy.deepcopy(self.spec)
        dashboard = next(view for view in spec["views"] if view["type"] == "dashboard")
        dashboard["widgets"][0].update({"aggregate": "sum", "field": "summary"})
        errors = validate_spec(spec)
        self.assertTrue(any("field must reference a numeric field for sum" in error for error in errors))

    def test_generated_foreign_key_collision_is_rejected(self) -> None:
        spec = copy.deepcopy(self.spec)
        spec["entities"][2]["fields"].append(
            {"key": "equipment_id", "label": "Colisión", "type": "text"}
        )
        errors = validate_spec(spec)
        self.assertTrue(any("collides with the generated foreign key" in error for error in errors))

    def test_sql_contains_real_tables_and_foreign_keys(self) -> None:
        sql = compile_sql(self.spec)
        self.assertIn('CREATE TABLE "equipment"', sql)
        self.assertIn('CREATE TABLE "work_order"', sql)
        self.assertIn('FOREIGN KEY ("equipment_id")', sql)
        self.assertIn('REFERENCES "equipment"(id)', sql)
        self.assertIn("EXECUTE FUNCTION app_set_updated_at()", sql)
        self.assertIn("app_audit_log_created_at_idx", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS app_import_batch", sql)
        self.assertIn("app_import_batch_expiry_idx", sql)
        self.assertIn("CREATE TABLE IF NOT EXISTS app_attachment", sql)
        self.assertIn("app_attachment_record_idx", sql)
        self.assertIn("octet_length(content) = size_bytes", sql)

    def test_report_describes_native_views_and_attachments(self) -> None:
        report = compile_report(self.spec)
        self.assertIn("Named table, kanban, calendar, and dashboard views", report)
        self.assertIn("stored transactionally in PostgreSQL", report)
        self.assertIn("opt-in bulk, kanban, and calendar mutations", report)

    def test_report_describes_server_authorization(self) -> None:
        report = compile_report(self.spec)
        self.assertIn("permission matrix is enforced server-side", report)
        self.assertIn("User administration assigns versioned AppSpec roles", report)
        self.assertIn("Clerk proves identity", report)
        self.assertIn("Production fails closed", report)
        self.assertIn("audit event in the same database transaction", report)
        self.assertIn("CSV/XLSX imports are size-limited", report)
        self.assertIn("Generic imports create new records only", report)
        self.assertIn("validated expression tree", report)
        self.assertIn("persistent application assistant", report)
        self.assertIn("bundled assistant is read-only", report)

    def test_scaffold_refuses_non_empty_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "project"
            output.mkdir()
            (output / "owned-by-user.txt").write_text("preserve", encoding="utf-8")
            with self.assertRaises(SpecError):
                scaffold(self.spec, output)
            self.assertEqual((output / "owned-by-user.txt").read_text(encoding="utf-8"), "preserve")

    def test_scaffold_is_complete_in_new_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "project"
            written = scaffold(self.spec, output)
            self.assertGreaterEqual(len(written), 25)
            self.assertTrue((output / "BUILD_REPORT.md").is_file())
            self.assertTrue((output / "src/features/EXTENSIONS.md").is_file())
            self.assertTrue((output / "src/app/records/[entity]/page.tsx").is_file())
            self.assertTrue((output / "src/app/records/[entity]/import/page.tsx").is_file())
            self.assertTrue((output / "src/app/records/[entity]/export/route.ts").is_file())
            self.assertTrue((output / "src/app/rules/page.tsx").is_file())
            self.assertTrue((output / "src/app/sign-in/[[...sign-in]]/page.tsx").is_file())
            self.assertTrue((output / "src/proxy.ts").is_file())
            self.assertTrue((output / "database/custom/120_clerk_authentication.sql").is_file())
            self.assertTrue((output / "src/lib/rules.ts").is_file())
            self.assertTrue((output / "src/app/views/[view]/page.tsx").is_file())
            self.assertTrue((output / "src/app/attachments/actions.ts").is_file())
            self.assertTrue((output / "src/app/attachments/[id]/route.ts").is_file())
            self.assertTrue((output / "src/app/record-operations/actions.ts").is_file())
            self.assertTrue((output / "src/lib/attachments.ts").is_file())
            self.assertTrue((output / "src/components/pagination.tsx").is_file())
            self.assertTrue((output / "src/components/bulk-record-table.tsx").is_file())
            self.assertTrue((output / "src/components/operational-kanban.tsx").is_file())
            self.assertTrue((output / "src/components/operational-calendar.tsx").is_file())
            self.assertTrue((output / "package.json").is_file())
            self.assertIn("uuid: 11.1.1", (output / "pnpm-workspace.yaml").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
