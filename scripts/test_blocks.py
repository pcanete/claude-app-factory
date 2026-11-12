#!/usr/bin/env python3
"""Pruebas del bloque estándar de procesos."""
from __future__ import annotations

import copy
import json
import re
import shutil
import tempfile
import unittest
from pathlib import Path

from blocks import REQUISITOS, BlockError, expand_blocks, faltantes, load_block
from evolve_app import plan_evolution
from scaffold_app import scaffold, validate_spec

ROOT = Path(__file__).resolve().parent.parent
EXAMPLE = ROOT / "references" / "example-maintenance.app-spec.json"
ENGINE = ROOT / "assets" / "runtime-nextjs" / "src" / "platform" / "processes" / "engine.ts"
CLAVES = {"proceso", "iteracion"}


def ejemplo() -> dict:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def sin_bloque() -> dict:
    spec = ejemplo()
    spec.pop("blocks", None)
    return spec


def entidad(spec: dict, clave: str) -> dict:
    return next(e for e in spec["entities"] if e["key"] == clave)


class BlockTests(unittest.TestCase):
    def test_el_ejemplo_declara_el_bloque_y_valida_expandido(self) -> None:
        expandida, notas = expand_blocks(ejemplo())
        self.assertEqual(validate_spec(expandida), [])
        self.assertTrue(CLAVES <= {e["key"] for e in expandida["entities"]})
        self.assertTrue({"procesos", "iteraciones"} <= {v["key"] for v in expandida["views"]})
        self.assertEqual(len(notas), 1)

    def test_sin_bloque_la_spec_no_cambia(self) -> None:
        spec = sin_bloque()
        self.assertEqual(expand_blocks(spec), (spec, []))

    def test_no_modifica_la_spec_recibida(self) -> None:
        spec = ejemplo()
        original = copy.deepcopy(spec)
        expand_blocks(spec)
        self.assertEqual(spec, original)

    def test_expandir_dos_veces_da_lo_mismo(self) -> None:
        una, _ = expand_blocks(ejemplo())
        dos, notas = expand_blocks(una)
        self.assertEqual(una, dos)
        self.assertEqual(notas, [])

    def test_permisos_salen_de_los_roles(self) -> None:
        expandida, _ = expand_blocks(ejemplo())
        self.assertEqual(entidad(expandida, "proceso")["permissions"]["admin"], ["list", "read", "create", "update", "delete"])
        self.assertEqual(entidad(expandida, "iteracion")["permissions"]["admin"], ["list", "read", "create", "update", "delete"])
        self.assertEqual(entidad(expandida, "iteracion")["permissions"]["technician"], ["list", "read"])

    def test_sin_capacidades_el_primer_rol_administra(self) -> None:
        spec = ejemplo()
        for rol in spec["roles"]:
            rol.pop("capabilities", None)
        expandida, _ = expand_blocks(spec)
        permisos = entidad(expandida, "proceso")["permissions"]
        self.assertIn("create", permisos[spec["roles"][0]["key"]])
        self.assertNotIn("create", permisos[spec["roles"][1]["key"]])

    def test_entidad_ya_declarada_y_compatible_se_respeta(self) -> None:
        base, _ = expand_blocks(ejemplo())
        iteracion = entidad(base, "iteracion")
        iteracion["fields"].append({"key": "prioridad", "label": "Prioridad", "type": "integer"})
        iteracion["permissions"]["supervisor"] = ["list", "read", "update"]
        base["views"] = [v for v in base["views"] if v.get("entity") != "iteracion"]
        expandida, notas = expand_blocks(base)
        self.assertEqual(entidad(expandida, "iteracion"), iteracion)
        # Si la aplicación quitó las vistas de una entidad que ya tenía, no vuelven.
        self.assertFalse(any(v.get("entity") == "iteracion" for v in expandida["views"]))
        self.assertEqual(notas, [])

    def test_entidad_ya_declarada_e_incompatible_falla_y_dice_que_falta(self) -> None:
        base, _ = expand_blocks(ejemplo())
        iteracion = entidad(base, "iteracion")
        iteracion["fields"] = [f for f in iteracion["fields"] if f["key"] != "carpeta"]
        origen = next(f for f in iteracion["fields"] if f["key"] == "origen")
        origen["options"] = [o for o in origen["options"] if o["key"] != "reproduccion"]
        with self.assertRaises(BlockError) as error:
            expand_blocks(base)
        self.assertIn("iteracion.carpeta", str(error.exception))
        self.assertIn("«reproduccion»", str(error.exception))

    def test_bloque_desconocido_no_valida(self) -> None:
        spec = ejemplo()
        spec["blocks"] = ["facturacion"]
        self.assertTrue(any("Unknown block" in e for e in validate_spec(spec)))

    def test_las_entidades_del_bloque_cumplen_lo_que_el_motor_exige(self) -> None:
        for block_entity in load_block("procesos")["entities"]:
            self.assertEqual(faltantes(block_entity, block_entity), [], block_entity["key"])

    def test_los_requisitos_coinciden_con_el_motor(self) -> None:
        # Si el motor empieza a exigir otro campo, el bloque tiene que darlo.
        codigo = ENGINE.read_text(encoding="utf-8")
        for clave, requisito in REQUISITOS.items():
            bloque = re.search(rf"\b{clave}: \{{(.*?)\n  \}}|\b{clave}: \{{(.*?)\}},\n", codigo, re.S)
            texto = bloque.group(1) or bloque.group(2)
            campos = re.findall(r'"(\w+)"', re.search(r"campos: \[([^\]]*)\]", texto).group(1))
            relaciones = re.findall(r'"(\w+)"', re.search(r"relaciones: \[([^\]]*)\]", texto).group(1))
            self.assertEqual(campos, requisito["campos"], clave)
            self.assertEqual(relaciones, requisito["relaciones"], clave)
            for campo, opciones in requisito["opciones"].items():
                lista = re.search(rf"{campo}: \[([^\]]*)\]", texto, re.S).group(1)
                self.assertEqual(sorted(re.findall(r'"(\w+)"', lista)), sorted(opciones), f"{clave}.{campo}")

    def test_agregar_el_bloque_a_una_aplicacion_existente_es_una_evolucion_segura(self) -> None:
        anterior = sin_bloque()
        propuesta, _ = expand_blocks({**anterior, "blocks": ["procesos"]})
        plan = plan_evolution(anterior, propuesta)
        self.assertEqual(plan.blocked, [])
        self.assertTrue(plan.changed)
        self.assertIn('CREATE TABLE "iteracion"', chr(10).join(plan.sql))

    def test_la_aplicacion_generada_guarda_la_spec_expandida(self) -> None:
        salida = Path(tempfile.mkdtemp()) / "app"
        try:
            scaffold(ejemplo(), salida)
            guardada = json.loads((salida / "app-spec.json").read_text(encoding="utf-8"))
            self.assertEqual(guardada["blocks"], ["procesos"])
            self.assertTrue(CLAVES <= {e["key"] for e in guardada["entities"]})
            self.assertIn('CREATE TABLE "iteracion"', (salida / "database/generated/001_initial.sql").read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(salida.parent, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
