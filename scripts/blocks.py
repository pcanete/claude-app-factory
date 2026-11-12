#!/usr/bin/env python3
"""
Bloques estándar del AppSpec.

Un bloque es un conjunto de entidades y vistas que la plataforma necesita con una forma fija.
El primero es `procesos`: las entidades `proceso` e `iteracion` con las que la plataforma guarda
lo que el equipo sabe hacer y cada vez que lo hizo. Una AppSpec lo pide con una línea:

    "blocks": ["procesos"]

y la fábrica lo expande antes de validar, tanto al generar como al evolucionar. La expansión
queda escrita en el `app-spec.json` de la aplicación, así que después de generarla esas
entidades son de la aplicación como cualquier otra: se ven, se evolucionan y se extienden.

Tres reglas sostienen que expandir sea seguro:

- **Sólo agrega.** Una entidad del bloque que la AppSpec ya declara no se toca: se comprueba que
  tenga lo que el motor necesita. Si le falta algo, la expansión falla y dice qué. Así una versión
  nueva del bloque nunca cambia en silencio el esquema de una aplicación instalada.
- **Las vistas acompañan a la entidad.** Sólo se agregan las vistas de las entidades que el bloque
  agrega en esta pasada; si la entidad ya estaba, sus vistas son decisión de la aplicación.
- **Los permisos salen de los roles.** Los roles con `manage_users` editan y borran procesos e
  iteraciones; el resto lee. Si ningún rol declara capacidades, el primero hace de administrador.
  Registrar una iteración no usa esta matriz: lo hace la herramienta, que valida lo que llega.

Uso, para agregar el bloque a una aplicación que ya existe:

    python scripts/blocks.py --spec <app>/app-spec.json --output <propuesta.app-spec.json>

y después `evolve_app.py` con esa propuesta, como cualquier cambio de esquema.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path
from typing import Any

BLOCKS_DIR = Path(__file__).resolve().parent.parent / "assets" / "blocks"
KNOWN_BLOCKS = ("procesos",)
FULL = ["list", "read", "create", "update", "delete"]
READ = ["list", "read"]

# Lo que el motor exige de cada entidad. Lo comprueba también
# `test_blocks.py` contra `src/platform/processes/engine.ts`.
REQUISITOS: dict[str, dict[str, Any]] = {
    "proceso": {
        "campos": ["nombre", "estado", "definicion"],
        "relaciones": [],
        "opciones": {"estado": ["publicado", "retirado"]},
    },
    "iteracion": {
        "campos": ["titulo", "carpeta", "archivos", "datos", "receta", "skill", "conversacion", "origen", "salio_igual", "que_falto", "autor"],
        "relaciones": ["proceso"],
        "opciones": {"origen": ["original", "reproduccion"]},
    },
}


class BlockError(Exception):
    pass


def load_block(key: str) -> dict[str, Any]:
    return json.loads((BLOCKS_DIR / f"{key}.json").read_text(encoding="utf-8"))


def admin_roles(spec: dict[str, Any]) -> list[str]:
    roles = [role for role in spec.get("roles", []) if isinstance(role, dict) and isinstance(role.get("key"), str)]
    admins = [role["key"] for role in roles if "manage_users" in (role.get("capabilities") or [])]
    if admins:
        return admins
    return [roles[0]["key"]] if roles else []


def block_permissions(entity_key: str, spec: dict[str, Any]) -> dict[str, list[str]]:
    admins = set(admin_roles(spec))
    permissions: dict[str, list[str]] = {}
    for role in spec.get("roles", []):
        key = role.get("key") if isinstance(role, dict) else None
        if not isinstance(key, str):
            continue
        # Quien administra edita y borra procesos e iteraciones desde el panel. El resto lee:
        # las iteraciones se registran con la herramienta, que es la que valida.
        permissions[key] = list(FULL) if key in admins else list(READ)
    return permissions


def faltantes(entity: dict[str, Any], block_entity: dict[str, Any]) -> list[str]:
    """Qué le falta a una entidad ya declarada para que el motor opere sobre ella."""
    clave = block_entity["key"]
    requisito = REQUISITOS.get(clave, {"campos": [], "relaciones": [], "opciones": {}})
    campos = {field.get("key"): field for field in entity.get("fields", []) if isinstance(field, dict)}
    tipos = {field["key"]: field["type"] for field in block_entity["fields"]}
    relaciones = {rel.get("key"): rel for rel in entity.get("relationships", []) if isinstance(rel, dict)}
    faltan: list[str] = []
    for campo in requisito["campos"]:
        actual = campos.get(campo)
        if actual is None:
            faltan.append(f"el campo {clave}.{campo}")
        elif actual.get("type") != tipos[campo]:
            faltan.append(f"que {clave}.{campo} sea de tipo {tipos[campo]} (es {actual.get('type')})")
    for relacion in requisito["relaciones"]:
        if relacion not in relaciones:
            faltan.append(f"la relación {clave}.{relacion}")
    for campo, opciones in requisito["opciones"].items():
        definidas = {option.get("key") for option in (campos.get(campo) or {}).get("options", []) or []}
        for opcion in opciones:
            if campo in campos and opcion not in definidas:
                faltan.append(f"la opción «{opcion}» en {clave}.{campo}")
    return faltan


def expand_blocks(spec: Any) -> tuple[Any, list[str]]:
    """Devuelve la AppSpec con sus bloques expandidos y notas de lo que se agregó.

    No modifica la AppSpec recibida. Una AppSpec sin `blocks` vuelve igual. Los errores de forma
    de `blocks` los informa `validate_spec`; acá sólo se expanden los bloques conocidos.
    """
    if not isinstance(spec, dict) or not isinstance(spec.get("blocks"), list):
        return spec, []
    expanded = copy.deepcopy(spec)
    entities = expanded.setdefault("entities", [])
    views = expanded.setdefault("views", [])
    if not isinstance(entities, list) or not isinstance(views, list):
        return spec, []
    notas: list[str] = []
    for block_key in expanded["blocks"]:
        if block_key not in KNOWN_BLOCKS:
            continue
        block = load_block(block_key)
        existentes = {entity.get("key"): entity for entity in entities if isinstance(entity, dict)}
        agregadas: set[str] = set()
        problemas: list[str] = []
        for block_entity in block["entities"]:
            actual = existentes.get(block_entity["key"])
            if actual is not None:
                problemas.extend(faltantes(actual, block_entity))
                continue
            entity = copy.deepcopy(block_entity)
            entity["permissions"] = block_permissions(entity["key"], expanded)
            entities.append(entity)
            agregadas.add(entity["key"])
        if problemas:
            raise BlockError(
                f"El bloque «{block_key}» no puede usar las entidades que la AppSpec ya declara. Falta:\n- "
                + "\n- ".join(problemas)
            )
        view_keys = {view.get("key") for view in views if isinstance(view, dict)}
        for view in block["views"]:
            if view["entity"] in agregadas and view["key"] not in view_keys:
                views.append(copy.deepcopy(view))
        if agregadas:
            notas.append(f"Bloque «{block_key}» v{block['version']}: agregó {', '.join(sorted(agregadas))}.")
    return expanded, notas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--spec", required=True, type=Path, help="AppSpec actual de la aplicación")
    parser.add_argument("--output", required=True, type=Path, help="Dónde escribir la propuesta")
    parser.add_argument("--block", default="procesos", choices=KNOWN_BLOCKS)
    args = parser.parse_args()

    if args.output.resolve() == args.spec.resolve():
        print("Escribí la propuesta en otro archivo: evolve_app.py necesita comparar con la actual.", file=sys.stderr)
        return 2
    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    blocks = spec.setdefault("blocks", [])
    if args.block not in blocks:
        blocks.append(args.block)
    try:
        expanded, notas = expand_blocks(spec)
    except BlockError as error:
        print(str(error), file=sys.stderr)
        return 1
    args.output.write_text(json.dumps(expanded, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    for nota in notas or [f"La AppSpec ya tenía las entidades del bloque «{args.block}»: sólo se lo declaró."]:
        print(nota)
    print(f"Propuesta escrita en {args.output}. Seguí con evolve_app.py --spec {args.output}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
