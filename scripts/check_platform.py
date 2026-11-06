#!/usr/bin/env python3
"""
Compara la plataforma de una aplicación generada con la de esta fábrica.

Responde la pregunta que hoy hay que contestar leyendo diferencias a mano: de todo lo que
cambió, ¿qué puedo reemplazar sin destruir trabajo ajeno?

Con el manifiesto que dejó la fábrica al generar (o al actualizar) la aplicación, cada
archivo de plataforma cae en uno de estos estados:

  actualizar    la aplicación lo tiene como salió de fábrica, y la fábrica avanzó
  agregar       la fábrica lo tiene y la aplicación no
  retirar       la fábrica lo quitó y la aplicación lo tiene intacto
  al dia        coincide con la versión nueva
  local         la aplicación lo cambió y la fábrica no: se conserva
  MODIFICADO    lo cambiaron los dos lados: hay que resolverlo a mano
  sin registro  difiere y el manifiesto no lo conoce: no se puede saber de quién es el
                cambio, así que se conserva
  BLOQUEADO     la fábrica cambió o quitó una migración de plataforma ya publicada

La distinción entre `actualizar`, `local` y `MODIFICADO` es la razón de existir de este
comando. Sin el manifiesto, los tres se ven igual --un archivo que difiere-- y quien
actualiza elige entre pisar trabajo ajeno o revisar todo el árbol.

`update_platform.py` usa esta misma comparación para aplicar la actualización.

Uso:
    python scripts/check_platform.py --project <ruta-de-la-aplicacion>
    python scripts/check_platform.py --project <ruta> --json
    python scripts/check_platform.py --project <ruta> --adopt
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scaffold_app import (  # noqa: E402
    PLATFORM_VERSION,
    platform_checksum,
    platform_paths,
)

FACTORY_RUNTIME = Path(__file__).resolve().parent.parent / "assets" / "runtime-nextjs"
ESTADOS = (
    "actualizar", "agregar", "retirar", "al_dia", "local", "modificado", "sin_registro", "bloqueado",
)


def es_migracion(relative: str) -> bool:
    return relative.startswith("database/platform/") and relative.endswith(".sql")


def leer_manifiesto(project: Path) -> dict | None:
    path = project / "platform-manifest.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def comparar(project: Path, factory_runtime: Path = FACTORY_RUNTIME) -> dict:
    manifest = leer_manifiesto(project)
    original: dict[str, str] = (manifest or {}).get("files", {})

    actuales = platform_paths(project)
    nuevos = platform_paths(factory_runtime)
    resultado: dict[str, list[str]] = {estado: [] for estado in ESTADOS}
    sumas_nuevas: dict[str, str] = {}

    for relative, path_nuevo in nuevos.items():
        suma_nueva = platform_checksum(path_nuevo)
        sumas_nuevas[relative] = suma_nueva
        path_actual = actuales.get(relative)
        if path_actual is None:
            resultado["agregar"].append(relative)
            continue
        suma_actual = platform_checksum(path_actual)
        suma_original = original.get(relative)
        if suma_actual == suma_nueva:
            estado = "al_dia"
        elif suma_original is None:
            estado = "sin_registro"
        elif suma_original == suma_actual:
            estado = "actualizar"
        elif suma_original == suma_nueva:
            estado = "local"
        else:
            estado = "modificado"
        # Una migración de plataforma ya publicada pudo haberse aplicado en la base: si la
        # fábrica la cambió, el registro de migraciones la rechaza en el próximo despliegue.
        if es_migracion(relative) and estado in ("actualizar", "modificado"):
            estado = "bloqueado"
        resultado[estado].append(relative)

    for relative, path_actual in actuales.items():
        if relative in nuevos:
            continue
        suma_original = original.get(relative)
        if suma_original is None:
            continue  # es del cliente: la fábrica nunca lo tuvo
        if es_migracion(relative):
            resultado["bloqueado"].append(relative)
        elif suma_original == platform_checksum(path_actual):
            resultado["retirar"].append(relative)
        else:
            resultado["local"].append(relative)

    return {
        "manifiesto": bool(manifest),
        "version_instalada": (manifest or {}).get("platform_version"),
        "version_fabrica": PLATFORM_VERSION,
        "sumas_fabrica": sumas_nuevas,
        **{estado: sorted(archivos) for estado, archivos in resultado.items()},
    }


TITULOS = [
    ("bloqueado", "BLOQUEADOS: la fábrica cambió o quitó una migración de plataforma ya publicada"),
    ("modificado", "MODIFICADOS LOCALMENTE Y TAMBIÉN EN LA FÁBRICA (resolver a mano)"),
    ("sin_registro", "difieren y el manifiesto no los conoce (se conservan)"),
    ("local", "modificados localmente, la fábrica no los tocó (se conservan)"),
    ("actualizar", "se pueden reemplazar sin perder nada"),
    ("agregar", "nuevos de la fábrica"),
    ("retirar", "la fábrica los quitó (se borran)"),
]


def imprimir(informe: dict) -> None:
    if not informe["manifiesto"]:
        print("Esta aplicación no tiene manifiesto de plataforma: se generó con una fábrica")
        print("anterior. Lo que difiera figura como «sin registro» y no se toca, porque no hay")
        print("forma de saber si lo cambió el cliente o la fábrica.\n")
    else:
        print(f"Plataforma instalada: {informe['version_instalada']}  ->  fábrica: {informe['version_fabrica']}\n")
    for clave, titulo in TITULOS:
        archivos = informe[clave]
        if not archivos:
            continue
        print(f"{titulo}: {len(archivos)}")
        for relative in archivos:
            print(f"  {relative}")
        print()
    print(f"al día: {len(informe['al_dia'])} archivos")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
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

    informe = comparar(project)

    if args.adopt:
        pendientes = [
            relative
            for estado in ("actualizar", "agregar", "retirar", "modificado", "local", "sin_registro", "bloqueado")
            for relative in informe[estado]
        ]
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
        salida = {clave: valor for clave, valor in informe.items() if clave != "sumas_fabrica"}
        print(json.dumps(salida, ensure_ascii=False, indent=2))
        return 1 if informe["modificado"] or informe["bloqueado"] else 0

    imprimir(informe)
    if informe["bloqueado"]:
        print("\nUna migración de plataforma publicada no se cambia: es un error de la fábrica,")
        print("no de esta aplicación. Reportalo antes de actualizar.")
        return 1
    if informe["modificado"]:
        print("\nHay archivos que cambiaron de los dos lados. Una actualización automática")
        print("los pisaría: resolvelos antes de copiar nada.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
