#!/usr/bin/env python3
"""
La versión de plataforma tiene que subir cuando cambia la plataforma.

Sin esta guarda pasó lo esperable: tres cambios de plataforma entraron a main con la misma
1.2.0, y una aplicación actualizada no se distinguía de una sin actualizar. La versión es
lo único que dice qué tiene instalado cada organización; si no se mueve, no dice nada.

Compara dos manifiestos de plataforma —el de una aplicación generada desde la base y el de
una generada desde esta rama— y falla si los archivos o el package.json cambiaron sin que
la versión suba.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def version_tuple(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in value.split("."))


def cambios(base: dict, head: dict) -> list[str]:
    archivos_base, archivos_head = base.get("files", {}), head.get("files", {})
    lista = [
        ruta
        for ruta in sorted(set(archivos_base) | set(archivos_head))
        if archivos_base.get(ruta) != archivos_head.get(ruta)
    ]
    if base.get("package") != head.get("package"):
        lista.append("package.json (dependencias o scripts)")
    return lista


def revisar(base: dict, head: dict) -> tuple[bool, str]:
    antes, ahora = base["platform_version"], head["platform_version"]
    lista = cambios(base, head)
    if not lista:
        return True, f"La plataforma no cambió (versión {ahora})."
    if version_tuple(ahora) > version_tuple(antes):
        return True, f"La plataforma cambió en {len(lista)} archivos y la versión subió: {antes} -> {ahora}."
    muestra = "\n".join(f"  {ruta}" for ruta in lista[:15])
    resto = f"\n  … y {len(lista) - 15} más" if len(lista) > 15 else ""
    return False, (
        f"La plataforma cambió en {len(lista)} archivos pero la versión sigue en {ahora} "
        f"(base: {antes}).\n{muestra}{resto}\n"
        "Subí PLATFORM_VERSION en scripts/scaffold_app.py: menor si agrega algo, "
        "parche si sólo corrige."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base", required=True, type=Path, help="platform-manifest.json generado desde la base")
    parser.add_argument("--head", required=True, type=Path, help="platform-manifest.json generado desde esta rama")
    args = parser.parse_args()
    ok, mensaje = revisar(
        json.loads(args.base.read_text(encoding="utf-8")),
        json.loads(args.head.read_text(encoding="utf-8")),
    )
    print(mensaje)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
