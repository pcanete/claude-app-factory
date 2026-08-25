#!/usr/bin/env python3
"""
Compara la plataforma de una aplicación generada con la de esta fábrica.

Responde la pregunta que hoy hay que contestar leyendo diferencias a mano: de todo lo que
cambió, ¿qué puedo reemplazar sin destruir trabajo ajeno?

Cada archivo de la zona de fábrica cae en uno de cinco estados:

  actualizar   la aplicación lo tiene igual a como salió de fábrica, y la fábrica avanzó
  agregar      la fábrica lo tiene y la aplicación no
  al dia       coincide con la versión nueva
  MODIFICADO   la aplicación lo cambió localmente y la fábrica también: hay que resolverlo
  local        la aplicación lo cambió localmente y la fábrica no lo tocó

La distinción entre `actualizar` y `MODIFICADO` es la razón de existir de este comando. Sin
el manifiesto, los dos se ven igual --un archivo que difiere-- y quien actualiza elige entre
pisar trabajo ajeno o revisar todo el árbol.

Uso:
    python scripts/check_platform.py --project <ruta-de-la-aplicacion>
    python scripts/check_platform.py --project <ruta> --json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scaffold_app import (  # noqa: E402
    PLATFORM_EXCLUDED,
    PLATFORM_TREES,
    PLATFORM_VERSION,
    normalize_newlines,
)


def checksum(path: Path) -> str:
    # Misma normalización que usó la fábrica al escribir el manifiesto: si divergieran,
    # todo figuraría como modificado en cuanto el archivo cruzara un sistema operativo.
    return hashlib.sha256(normalize_newlines(path.read_bytes())).hexdigest()


def platform_files(root: Path) -> dict[str, Path]:
    encontrados: dict[str, Path] = {}
    for tree in PLATFORM_TREES:
        base = root / tree
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if any(relative.startswith(excluded) for excluded in PLATFORM_EXCLUDED):
                continue
            if relative.endswith((".md", ".keep")):
                continue
            encontrados[relative] = path
    return encontrados


def comparar(project: Path, factory_runtime: Path) -> dict:
    manifest_path = project / "platform-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.is_file() else None
    original = (manifest or {}).get("files", {})

    actuales = platform_files(project)
    nuevos = platform_files(factory_runtime)

    resultado: dict[str, list[str]] = {
        "actualizar": [], "agregar": [], "al_dia": [], "modificado": [], "local": [],
    }

    for relative, path_nuevo in nuevos.items():
        suma_nueva = checksum(path_nuevo)
        path_actual = actuales.get(relative)
        if path_actual is None:
            resultado["agregar"].append(relative)
            continue
        suma_actual = checksum(path_actual)
        if suma_actual == suma_nueva:
            resultado["al_dia"].append(relative)
            continue
        suma_original = original.get(relative)
        if suma_original is None:
            # Sin manifiesto no se puede distinguir: se asume lo prudente.
            resultado["modificado" if manifest else "actualizar"].append(relative)
        elif suma_original == suma_actual:
            resultado["actualizar"].append(relative)
        else:
            resultado["modificado"].append(relative)

    for relative, path_actual in actuales.items():
        if relative in nuevos:
            continue
        suma_original = original.get(relative)
        if suma_original and suma_original != checksum(path_actual):
            resultado["local"].append(relative)

    return {
        "manifiesto": bool(manifest),
        "version_instalada": (manifest or {}).get("platform_version"),
        "version_fabrica": PLATFORM_VERSION,
        **resultado,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--json", action="store_true", help="Salida legible por otro programa")
    parser.add_argument(
        "--adopt",
        action="store_true",
        help=(
            "Escribe el manifiesto para una aplicación generada antes de que existiera. "
            "Sólo procede si todo coincide con la fábrica: si algo difiere, no hay forma de "
            "saber si lo cambió el cliente o la fábrica, y adoptarlo sellaría esa duda."
        ),
    )
    args = parser.parse_args()

    project: Path = args.project
    if not project.is_dir():
        print(f"No existe el proyecto: {project}", file=sys.stderr)
        return 2

    factory_runtime = Path(__file__).resolve().parent.parent / "assets" / "runtime-nextjs"
    informe = comparar(project, factory_runtime)

    if args.adopt:
        pendientes = informe["actualizar"] + informe["agregar"] + informe["modificado"] + informe["local"]
        if pendientes:
            print("No se puede adoptar el manifiesto: hay archivos que no coinciden con la fábrica.")
            print("Actualizá primero, y adoptá cuando el árbol esté al día.\n")
            for relative in pendientes[:20]:
                print(f"  {relative}")
            return 1
        from scaffold_app import platform_manifest  # noqa: PLC0415

        destino = project / "platform-manifest.json"
        destino.write_text(
            json.dumps(platform_manifest(project), ensure_ascii=False, indent=2) + chr(10),
            encoding="utf-8",
            newline=chr(10),
        )
        print(f"Manifiesto escrito en {destino.name}: {len(informe['al_dia'])} archivos de plataforma.")
        print("Desde ahora una actualización puede distinguir lo que editó el cliente.")
        return 0

    if args.json:
        print(json.dumps(informe, ensure_ascii=False, indent=2))
        return 1 if informe["modificado"] else 0

    if not informe["manifiesto"]:
        print("Esta aplicación no tiene manifiesto de plataforma: se generó con una fábrica")
        print("anterior. Todo lo que difiera va a figurar como pendiente de actualizar, sin")
        print("poder distinguir lo que quizá se modificó localmente. Revisá el diff antes.\n")
    else:
        print(f"Plataforma instalada: {informe['version_instalada']}  ->  fábrica: {informe['version_fabrica']}\n")

    for clave, titulo in [
        ("modificado", "MODIFICADOS LOCALMENTE Y TAMBIÉN EN LA FÁBRICA (resolver a mano)"),
        ("local", "modificados localmente, la fábrica no los tocó (se conservan)"),
        ("actualizar", "se pueden reemplazar sin perder nada"),
        ("agregar", "nuevos de la fábrica"),
    ]:
        archivos = informe[clave]
        if not archivos:
            continue
        print(f"{titulo}: {len(archivos)}")
        for relative in archivos:
            print(f"  {relative}")
        print()

    print(f"al día: {len(informe['al_dia'])} archivos")
    if informe["modificado"]:
        print("\nHay archivos que cambiaron de los dos lados. Una actualización automática")
        print("los pisaría: resolvelos antes de copiar nada.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
