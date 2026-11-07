#!/usr/bin/env python3
"""
Actualiza la plataforma de una aplicación ya generada a la versión de esta fábrica.

Es la otra mitad de la evolución: `evolve_app.py` resuelve «cambió lo que el cliente
necesita»; esto resuelve «mejoró la fábrica». Sin esto, cada aplicación desplegada se queda
con la plataforma con la que nació, y cada organización nueva es una copia que se
desactualiza.

Qué hace, a partir de la comparación de `check_platform.py`:

  - reemplaza los archivos de plataforma que la aplicación tiene intactos, agrega los
    nuevos y borra los que la fábrica retiró;
  - conserva lo que la aplicación cambió localmente, y se niega a seguir si un archivo
    cambió de los dos lados;
  - combina `package.json`: lo que declara la fábrica se actualiza, lo que agregó el cliente
    queda; el lockfile sólo se copia si no hay dependencias propias;
  - vuelve a compilar `src/generated/` desde la `app-spec.json` de la aplicación, porque la
    plataforma nueva puede esperar otra forma de lo generado;
  - lista las migraciones de plataforma nuevas sin aplicarlas, y las variables de entorno
    que la versión nueva lee y la instalada no;
  - reescribe el manifiesto con lo que quedó.

Nunca toca `src/features/`, `src/components/custom/`, `database/custom/`,
`database/generated/` ni `app-spec.json`. No aplica migraciones ni despliega.

Uso:
    python scripts/update_platform.py --project <ruta>            # sólo muestra el plan
    python scripts/update_platform.py --project <ruta> --apply    # lo aplica

Códigos de salida: 0 bien, 1 conflictos (no se escribió nada), 2 error de uso,
3 bloqueado (no se escribió nada).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_platform import FACTORY_RUNTIME, comparar, es_migracion, imprimir, leer_manifiesto  # noqa: E402
from scaffold_app import (  # noqa: E402
    PACKAGE_SECTIONS,
    PLATFORM_VERSION,
    compile_navigation,
    compile_permissions,
    compile_registry,
    manifest_document,
    package_snapshot,
    platform_paths,
    validate_spec,
)

GENERATED = {
    "src/generated/app-spec.ts": compile_registry,
    "src/generated/navigation.ts": compile_navigation,
    "src/generated/permissions.ts": compile_permissions,
}
# `name` y `version` son de la aplicación; lo demás que declare la fábrica fuera de las
# secciones (packageManager, engines, type) define cómo corre la plataforma.
PACKAGE_OWN_KEYS = ("name", "version")
ENV_PATTERN = re.compile(r"process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*[\"']([A-Z][A-Z0-9_]*)[\"']\s*\])")


def version_tuple(value: str | None) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in str(value).split("."))
    except ValueError:
        return ()


@dataclass
class Plan:
    informe: dict
    bloqueos: list[str] = field(default_factory=list)
    conflictos: list[str] = field(default_factory=list)
    package_text: str | None = None
    package_notas: list[str] = field(default_factory=list)
    package_snapshot: dict = field(default_factory=dict)
    copiar_lockfile: bool = False
    lockfile_nota: str | None = None
    generados: dict[str, str] = field(default_factory=dict)
    migraciones: list[str] = field(default_factory=list)
    variables: list[str] = field(default_factory=list)
    # Un manifiesto escrito por una fábrica anterior no conoce todos los archivos que hoy son
    # de plataforma: volver a sellarlo deja registrados los que ya coinciden.
    manifiesto_incompleto: bool = False

    @property
    def cambios(self) -> bool:
        informe = self.informe
        return bool(
            informe["actualizar"] or informe["agregar"] or informe["retirar"]
            or self.package_text or self.copiar_lockfile or self.generados
            or informe["version_instalada"] != PLATFORM_VERSION
            or self.manifiesto_incompleto
        )


def variables_de(archivos: dict[str, Path]) -> set[str]:
    nombres: set[str] = set()
    for path in archivos.values():
        if path.suffix not in (".ts", ".tsx", ".mjs", ".js"):
            continue
        for match in ENV_PATTERN.finditer(path.read_text(encoding="utf-8", errors="ignore")):
            nombres.add(match.group(1) or match.group(2))
    return nombres


def combinar_package(project: Path, factory_runtime: Path, anterior: dict | None) -> tuple[dict, list[str], dict]:
    actual = json.loads((project / "package.json").read_text(encoding="utf-8"))
    fabrica = json.loads((factory_runtime / "package.json").read_text(encoding="utf-8"))
    combinado = dict(actual)
    notas: list[str] = []

    for clave, valor in fabrica.items():
        if clave in PACKAGE_OWN_KEYS or clave in PACKAGE_SECTIONS:
            continue
        if combinado.get(clave) != valor:
            notas.append(f"{clave}: {json.dumps(combinado.get(clave))} -> {json.dumps(valor)}")
            combinado[clave] = valor

    for seccion in PACKAGE_SECTIONS:
        propio = dict(actual.get(seccion) or {})
        de_fabrica = fabrica.get(seccion) or {}
        for nombre, valor in de_fabrica.items():
            if nombre not in propio:
                notas.append(f"{seccion}.{nombre}: agregado {valor}")
            elif propio[nombre] != valor:
                notas.append(f"{seccion}.{nombre}: {propio[nombre]} -> {valor}")
            propio[nombre] = valor
        antes = (anterior or {}).get(seccion) or {}
        for nombre, valor in antes.items():
            if nombre in de_fabrica or nombre not in propio:
                continue
            if propio[nombre] == valor:
                del propio[nombre]
                notas.append(f"{seccion}.{nombre}: la fábrica lo retiró")
            else:
                notas.append(f"{seccion}.{nombre}: la fábrica lo retiró, pero la aplicación lo cambió y se conserva")
        if propio or seccion in actual:
            combinado[seccion] = propio

    return combinado, notas, package_snapshot(fabrica)


def dependencias_propias(package: dict, factory_runtime: Path) -> list[str]:
    fabrica = json.loads((factory_runtime / "package.json").read_text(encoding="utf-8"))
    propias = []
    for seccion in ("dependencies", "devDependencies"):
        declaradas = fabrica.get(seccion) or {}
        propias += [f"{seccion}.{nombre}" for nombre in (package.get(seccion) or {}) if nombre not in declaradas]
    return propias


def planificar(project: Path, factory_runtime: Path = FACTORY_RUNTIME) -> Plan:
    informe = comparar(project, factory_runtime)
    plan = Plan(informe=informe)
    manifest = leer_manifiesto(project)

    if not manifest:
        plan.bloqueos.append(
            "La aplicación no tiene manifiesto de plataforma: sin él no se puede distinguir lo que "
            "cambió el cliente. Si la plataforma coincide con la de la fábrica, sellalo con "
            "`check_platform.py --adopt`; si no, la primera actualización es a mano."
        )
    instalada = version_tuple(informe["version_instalada"])
    if instalada and instalada > version_tuple(PLATFORM_VERSION):
        plan.bloqueos.append(
            f"La aplicación tiene la plataforma {informe['version_instalada']}, más nueva que la de esta "
            f"fábrica ({PLATFORM_VERSION}). Actualizá la fábrica, no la aplicación."
        )
    for relative in informe["bloqueado"]:
        plan.bloqueos.append(f"Migración de plataforma publicada que la fábrica cambió o quitó: {relative}")

    spec_path = project / "app-spec.json"
    if not spec_path.is_file():
        plan.bloqueos.append("La aplicación no tiene app-spec.json: no la generó esta fábrica.")
    else:
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        errores = validate_spec(spec)
        if errores:
            plan.bloqueos.append(
                "La app-spec.json de la aplicación no valida con esta fábrica: "
                + "; ".join(errores[:5])
            )
        else:
            for relative, compilar in GENERATED.items():
                nuevo = compilar(spec)
                destino = project / relative
                actual = destino.read_text(encoding="utf-8") if destino.is_file() else None
                if actual is None or actual.replace("\r\n", "\n") != nuevo:
                    plan.generados[relative] = nuevo

    plan.conflictos = list(informe["modificado"])
    if manifest:
        conocidos = manifest.get("files", {})
        plan.manifiesto_incompleto = "package" not in manifest or any(
            relative not in conocidos for relative in informe["al_dia"]
        )

    if (project / "package.json").is_file() and (factory_runtime / "package.json").is_file():
        combinado, notas, snapshot = combinar_package(project, factory_runtime, (manifest or {}).get("package"))
        plan.package_snapshot = snapshot
        actual = json.loads((project / "package.json").read_text(encoding="utf-8"))
        if combinado != actual:
            plan.package_text = json.dumps(combinado, ensure_ascii=False, indent=2) + "\n"
            plan.package_notas = notas
        propias = dependencias_propias(combinado, factory_runtime)
        lock_fabrica = factory_runtime / "pnpm-lock.yaml"
        lock_actual = project / "pnpm-lock.yaml"
        if lock_fabrica.is_file():
            if propias:
                if plan.package_text:
                    plan.lockfile_nota = (
                        "La aplicación tiene dependencias propias (" + ", ".join(propias)
                        + "): el lockfile no se copia. Regeneralo con `pnpm install`."
                    )
            elif not lock_actual.is_file() or lock_actual.read_bytes() != lock_fabrica.read_bytes():
                plan.copiar_lockfile = True

    plan.migraciones = [relative for relative in informe["agregar"] if es_migracion(relative)]
    nuevas = variables_de(platform_paths(factory_runtime)) - variables_de(platform_paths(project))
    plan.variables = sorted(nuevas)
    return plan


def arbol_limpio(project: Path) -> str | None:
    """None si el árbol está limpio; si no, por qué no se puede seguir."""
    try:
        salida = subprocess.run(
            ["git", "-C", str(project), "status", "--porcelain"],
            capture_output=True, text=True, check=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return "La aplicación no es un repositorio git: sin eso la actualización no se puede deshacer."
    if salida.strip():
        return "Hay cambios sin commitear en la aplicación. Commitealos o guardalos antes: así la actualización queda como un cambio aparte y se puede deshacer."
    return None


def aplicar(plan: Plan, project: Path, factory_runtime: Path = FACTORY_RUNTIME, conservar: bool = False) -> list[str]:
    informe = plan.informe
    escritos: list[str] = []

    for relative in informe["actualizar"] + informe["agregar"]:
        destino = project / relative
        destino.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(factory_runtime / relative, destino)
        escritos.append(relative)
    for relative in informe["retirar"]:
        (project / relative).unlink()
        escritos.append(f"{relative} (borrado)")

    if plan.package_text:
        (project / "package.json").write_text(plan.package_text, encoding="utf-8", newline="\n")
        escritos.append("package.json")
    if plan.copiar_lockfile:
        shutil.copyfile(factory_runtime / "pnpm-lock.yaml", project / "pnpm-lock.yaml")
        escritos.append("pnpm-lock.yaml")
    for relative, contenido in plan.generados.items():
        destino = project / relative
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(contenido, encoding="utf-8", newline="\n")
        escritos.append(relative)

    # El manifiesto describe lo que salió de fábrica, no lo que hay en disco: un archivo que
    # se conservó con cambios locales guarda la suma anterior, así sigue figurando como local.
    anterior = (leer_manifiesto(project) or {}).get("files", {})
    sumas = informe["sumas_fabrica"]
    archivos: dict[str, str] = {}
    for relative, suma in sumas.items():
        if relative in informe["actualizar"] or relative in informe["agregar"] or relative in informe["al_dia"]:
            archivos[relative] = suma
        elif relative in anterior:
            archivos[relative] = anterior[relative]
    for relative in informe["local"]:
        if relative not in sumas and relative in anterior:
            archivos[relative] = anterior[relative]
    if conservar:
        for relative in informe["modificado"]:
            archivos[relative] = anterior[relative]
    documento = manifest_document(archivos, plan.package_snapshot)
    (project / "platform-manifest.json").write_text(
        json.dumps(documento, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n",
    )
    escritos.append("platform-manifest.json")
    return escritos


def imprimir_plan(plan: Plan) -> None:
    imprimir(plan.informe)
    if plan.package_notas:
        print("\npackage.json:")
        for nota in plan.package_notas:
            print(f"  {nota}")
    if plan.copiar_lockfile:
        print("\npnpm-lock.yaml: se reemplaza por el de la fábrica")
    if plan.lockfile_nota:
        print(f"\n{plan.lockfile_nota}")
    if plan.manifiesto_incompleto:
        print("\nel manifiesto se vuelve a sellar: lo escribió una fábrica que conocía menos archivos")
    if plan.generados:
        print("\nse vuelven a compilar desde app-spec.json:")
        for relative in plan.generados:
            print(f"  {relative}")
    if plan.migraciones:
        print("\nmigraciones de plataforma nuevas (no se aplican acá; corré `pnpm db:apply`):")
        for relative in plan.migraciones:
            print(f"  {relative}")
    if plan.variables:
        print("\nvariables de entorno que la versión nueva lee y la instalada no:")
        for nombre in plan.variables:
            print(f"  {nombre}")
        print("  Revisá si hacen falta en el despliegue antes de publicar.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, type=Path)
    parser.add_argument("--apply", action="store_true", help="Aplica el plan. Sin esto sólo lo muestra.")
    parser.add_argument(
        "--conservar-locales",
        action="store_true",
        help=(
            "Sigue aunque haya archivos que cambiaron de los dos lados: los deja como están en "
            "la aplicación, y siguen figurando como modificados hasta que alguien los resuelva."
        ),
    )
    args = parser.parse_args()

    project: Path = args.project.resolve()
    if not project.is_dir():
        print(f"No existe el proyecto: {project}", file=sys.stderr)
        return 2

    plan = planificar(project)
    imprimir_plan(plan)

    if plan.bloqueos:
        print("\nBLOQUEADO, no se escribió nada:")
        for motivo in plan.bloqueos:
            print(f"  - {motivo}")
        return 3
    if plan.conflictos and not args.conservar_locales:
        print("\nHay archivos que cambiaron en la aplicación y también en la fábrica. Resolvelos")
        print("(llevá el cambio local a `src/features/` o descartalo) y volvé a correr esto, o")
        print("seguí con --conservar-locales para dejarlos como están. No se escribió nada.")
        return 1
    if not plan.cambios:
        print("\nLa plataforma ya está al día.")
        return 0
    if not args.apply:
        print("\nEsto es el plan. Para aplicarlo: --apply")
        return 0

    sucio = arbol_limpio(project)
    if sucio:
        print(f"\n{sucio} No se escribió nada.", file=sys.stderr)
        return 2

    escritos = aplicar(plan, project, conservar=args.conservar_locales)
    print(f"\nActualizada a la plataforma {PLATFORM_VERSION}: {len(escritos)} archivos.")
    print("\nSigue, en este orden:")
    paso = 1
    if plan.package_text or plan.copiar_lockfile or plan.lockfile_nota:
        print(f"  {paso}. pnpm install"); paso += 1
    if plan.migraciones:
        print(f"  {paso}. pnpm db:apply  (primero contra una base de prueba)"); paso += 1
    print(f"  {paso}. pnpm typecheck"); paso += 1
    print(f"  {paso}. revisar el diff y commitearlo como un cambio aparte"); paso += 1
    print(f"  {paso}. desplegar y comprobar contra la aplicación corriendo, no contra el log del build")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
