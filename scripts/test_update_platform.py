#!/usr/bin/env python3
"""Pruebas del actualizador de plataforma contra una fábrica simulada.

Cada prueba genera una aplicación con la fábrica real, copia el runtime a una carpeta
temporal y lo cambia como lo cambiaría una versión nueva de la fábrica. Así se prueba la
decisión de cada archivo sin depender de cómo esté la historia del repositorio.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from check_platform import FACTORY_RUNTIME, comparar
from scaffold_app import platform_paths, scaffold
from update_platform import aplicar, arbol_limpio, planificar

EXAMPLE = Path(__file__).resolve().parent.parent / "references" / "example-maintenance.app-spec.json"
TOKENS = ("__APP_KEY__", "__PRIMARY__", "__SURFACE__")


class UpdatePlatformTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.app = self.tmp / "app"
        self.factory = self.tmp / "factory"
        scaffold(json.loads(EXAMPLE.read_text(encoding="utf-8")), self.app)
        shutil.copytree(FACTORY_RUNTIME, self.factory, ignore=shutil.ignore_patterns("node_modules", ".next"))

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def editar(self, root: Path, relative: str, agregado: str) -> None:
        path = root / relative
        path.write_text(path.read_text(encoding="utf-8") + agregado, encoding="utf-8")

    def test_recien_generada_esta_al_dia(self) -> None:
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.bloqueos, [])
        self.assertEqual(plan.conflictos, [])
        self.assertFalse(plan.cambios)

    def test_archivo_intacto_se_actualiza_y_queda_al_dia(self) -> None:
        self.editar(self.factory, "src/platform/mcp/server.ts", "\n// versión nueva\n")
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.informe["actualizar"], ["src/platform/mcp/server.ts"])
        aplicar(plan, self.app, self.factory)
        self.assertIn("// versión nueva", (self.app / "src/platform/mcp/server.ts").read_text(encoding="utf-8"))
        self.assertFalse(planificar(self.app, self.factory).cambios)

    def test_cambio_local_sin_cambio_de_fabrica_se_conserva(self) -> None:
        self.editar(self.app, "src/app/not-found.tsx", "\n// del cliente\n")
        self.editar(self.factory, "src/platform/mcp/server.ts", "\n// versión nueva\n")
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.informe["local"], ["src/app/not-found.tsx"])
        self.assertEqual(plan.conflictos, [])
        aplicar(plan, self.app, self.factory)
        self.assertIn("// del cliente", (self.app / "src/app/not-found.tsx").read_text(encoding="utf-8"))
        # Sigue figurando como local: el manifiesto no selló el cambio del cliente como de fábrica.
        self.assertEqual(comparar(self.app, self.factory)["local"], ["src/app/not-found.tsx"])

    def test_cambio_de_los_dos_lados_es_conflicto(self) -> None:
        self.editar(self.app, "src/platform/mcp/server.ts", "\n// del cliente\n")
        self.editar(self.factory, "src/platform/mcp/server.ts", "\n// versión nueva\n")
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.conflictos, ["src/platform/mcp/server.ts"])
        aplicar(plan, self.app, self.factory, conservar=True)
        contenido = (self.app / "src/platform/mcp/server.ts").read_text(encoding="utf-8")
        self.assertIn("// del cliente", contenido)
        self.assertNotIn("// versión nueva", contenido)
        self.assertEqual(comparar(self.app, self.factory)["modificado"], ["src/platform/mcp/server.ts"])

    def test_archivo_retirado_por_la_fabrica_se_borra(self) -> None:
        (self.factory / "src/app/not-found.tsx").unlink()
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.informe["retirar"], ["src/app/not-found.tsx"])
        aplicar(plan, self.app, self.factory)
        self.assertFalse((self.app / "src/app/not-found.tsx").exists())

    def test_archivo_propio_en_zona_de_plataforma_no_se_toca(self) -> None:
        propio = self.app / "src/app/cotizador/page.tsx"
        propio.parent.mkdir(parents=True)
        propio.write_text("export default function P() { return null; }\n", encoding="utf-8")
        plan = planificar(self.app, self.factory)
        self.assertNotIn("src/app/cotizador/page.tsx", plan.informe["retirar"])
        self.assertFalse(plan.cambios)

    def test_migracion_publicada_cambiada_bloquea(self) -> None:
        migracion = next(r for r in platform_paths(self.factory) if r.startswith("database/platform/"))
        self.editar(self.factory, migracion, "\n-- cambio\n")
        plan = planificar(self.app, self.factory)
        self.assertTrue(any(migracion in motivo for motivo in plan.bloqueos))

    def test_migracion_nueva_se_lista(self) -> None:
        (self.factory / "database/platform/990_nueva.sql").write_text("SELECT 1;\n", encoding="utf-8")
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.migraciones, ["database/platform/990_nueva.sql"])

    def test_package_combina_y_respeta_lo_del_cliente(self) -> None:
        app_pkg = json.loads((self.app / "package.json").read_text(encoding="utf-8"))
        app_pkg["dependencies"]["date-fns"] = "^4.1.0"
        app_pkg["scripts"]["cotizar"] = "node cotizar.mjs"
        (self.app / "package.json").write_text(json.dumps(app_pkg, indent=2) + "\n", encoding="utf-8")

        fab_pkg = json.loads((self.factory / "package.json").read_text(encoding="utf-8"))
        fab_pkg["dependencies"]["nueva-lib"] = "^1.0.0"
        del fab_pkg["dependencies"]["exceljs"]
        fab_pkg["scripts"]["db:nuevo"] = "node scripts/nuevo.mjs"
        (self.factory / "package.json").write_text(json.dumps(fab_pkg, indent=2) + "\n", encoding="utf-8")

        plan = planificar(self.app, self.factory)
        self.assertIsNotNone(plan.package_text)
        combinado = json.loads(plan.package_text)
        self.assertEqual(combinado["name"], app_pkg["name"])
        self.assertEqual(combinado["dependencies"]["date-fns"], "^4.1.0")
        self.assertEqual(combinado["dependencies"]["nueva-lib"], "^1.0.0")
        self.assertNotIn("exceljs", combinado["dependencies"])
        self.assertEqual(combinado["scripts"]["cotizar"], "node cotizar.mjs")
        self.assertIn("db:nuevo", combinado["scripts"])
        # Con dependencias propias el lockfile de fábrica no sirve: hay que regenerarlo.
        self.assertFalse(plan.copiar_lockfile)
        self.assertIn("pnpm install", plan.lockfile_nota or "")

    def test_lockfile_se_copia_sin_dependencias_propias(self) -> None:
        self.editar(self.factory, "pnpm-lock.yaml", "\n# versión nueva\n")
        plan = planificar(self.app, self.factory)
        self.assertTrue(plan.copiar_lockfile)

    def test_variable_de_entorno_nueva_se_avisa(self) -> None:
        self.editar(self.factory, "src/platform/mcp/server.ts", "\nconst x = process.env.TALLER_URL;\n")
        plan = planificar(self.app, self.factory)
        self.assertEqual(plan.variables, ["TALLER_URL"])

    def test_sin_manifiesto_bloquea(self) -> None:
        (self.app / "platform-manifest.json").unlink()
        self.assertTrue(planificar(self.app, self.factory).bloqueos)

    def test_spec_invalida_bloquea(self) -> None:
        (self.app / "app-spec.json").write_text("{}", encoding="utf-8")
        self.assertTrue(planificar(self.app, self.factory).bloqueos)

    def test_generado_desactualizado_se_recompila(self) -> None:
        (self.app / "src/generated/navigation.ts").write_text("// viejo\n", encoding="utf-8")
        plan = planificar(self.app, self.factory)
        self.assertEqual(list(plan.generados), ["src/generated/navigation.ts"])

    def test_arbol_sucio_no_se_actualiza(self) -> None:
        if shutil.which("git") is None:
            self.skipTest("git no está instalado")
        self.assertIsNotNone(arbol_limpio(self.app))  # no es repositorio
        subprocess.run(["git", "init", "-q"], cwd=self.app, check=True)
        self.assertIsNotNone(arbol_limpio(self.app))  # todo sin commitear
        subprocess.run(["git", "-c", "core.autocrlf=false", "add", "-A"], cwd=self.app, check=True)
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"],
            cwd=self.app, check=True,
        )
        self.assertIsNone(arbol_limpio(self.app))

    def test_ningun_archivo_comparado_lleva_marcadores_de_plantilla(self) -> None:
        # La comparación usa el runtime de fábrica tal cual; un marcador sin reemplazar en un
        # archivo comparado haría que figure siempre como pendiente de actualizar.
        for relative, path in platform_paths(FACTORY_RUNTIME).items():
            contenido = path.read_text(encoding="utf-8", errors="ignore")
            for token in TOKENS:
                self.assertNotIn(token, contenido, relative)


if __name__ == "__main__":
    unittest.main()
