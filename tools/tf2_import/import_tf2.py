#!/usr/bin/env python3
"""Importa los nueve personajes de Team Fortress 2 desde TU instalación.

Los modelos son de Valve. Este repositorio es público, así que no van dentro:
`game/assets/models/characters_tf2/` está en `.gitignore` y el juego funciona
sin ella —usa los CC0 de KayKit—. Quien quiera ver el juego con los personajes
de TF2 los saca de su propia copia con este script.

El reparto de clase por arquetipo NO es una elección nueva: es exactamente el
que hacía el proyecto de 2012 en `core/lib/ResourceManager.cc:560-770`, donde
cada entidad tenía asignada la skin de una clase de TF2.

Uso:

    python3 tools/tf2_import/import_tf2.py                 # busca Steam solo
    python3 tools/tf2_import/import_tf2.py --steam RUTA    # se la dices tú
    python3 tools/tf2_import/import_tf2.py --extract-only  # sin convertir
    python3 tools/tf2_import/import_tf2.py --blender RUTA  # Blender concreto

La conversión de `.mdl` a `.glb` necesita **Blender con Blender Source Tools**
(https://developer.valvesoftware.com/wiki/Blender_Source_Tools). Es el único
camino razonable: los formatos de Valve son binarios, versionados y con la
geometría repartida entre tres ficheros, y reimplementarlos aquí sería escribir
un importador entero para ahorrarse una dependencia que el usuario instala una
vez.

AVISO HONESTO: el lector de VPK está probado (`test_vpk.py`), pero la búsqueda
de Steam, la extracción de un TF2 real y el paso por Blender NO se han podido
probar en el entorno donde se escribió esto, porque allí no hay ni Steam ni el
juego. Si algo falla, falla ruidosamente y diciendo qué esperaba encontrar.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vpk import Vpk, VpkError  # noqa: E402

# Arquetipo del remake -> clase de TF2, tal y como lo repartía el original.
CLASS_BY_ARCHETYPE = {
    "captain": "soldier",
    "technician": "scout",
    "specialist": "heavy",
    "demolition": "demo",
    "enemy_thug": "pyro",
    "enemy_militiaman": "sniper",
    "enemy_veteran": "engineer",
    "miniboss": "spy",
    "megaboss": "medic",
}

# Las tres piezas de un modelo de Source. Sin las tres no hay malla: el `.mdl`
# es solo el esqueleto y los materiales, los vértices están en el `.vvd` y las
# tiras de triángulos en el `.vtx`.
MODEL_SUFFIXES = (".mdl", ".vvd", ".dx90.vtx", ".dx80.vtx", ".sw.vtx")

STEAM_GUESSES = (
    "~/.steam/steam",
    "~/.local/share/Steam",
    "~/.steam/root",
    "~/Library/Application Support/Steam",
    "C:/Program Files (x86)/Steam",
    "C:/Program Files/Steam",
)


def find_steam(explicit: str | None) -> str:
    if explicit:
        if not os.path.isdir(explicit):
            raise SystemExit(f"No existe la carpeta de Steam indicada: {explicit}")
        return explicit
    for guess in STEAM_GUESSES:
        path = os.path.expanduser(guess)
        if os.path.isdir(os.path.join(path, "steamapps")):
            return path
    raise SystemExit(
        "No encuentro Steam. Pásame su carpeta con --steam "
        "(la que contiene 'steamapps').")


def steam_libraries(steam: str) -> list[str]:
    """Todas las bibliotecas de Steam, no solo la principal.

    Casi nadie tiene los juegos donde Steam se instaló: mirar solo ahí es la
    forma más común de decirle a alguien que no tiene un juego que sí tiene.
    """
    libraries = [steam]
    vdf = os.path.join(steam, "steamapps", "libraryfolders.vdf")
    if not os.path.exists(vdf):
        return libraries
    with open(vdf, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            parts = line.split('"')
            if len(parts) >= 4 and parts[1] == "path":
                candidate = parts[3].replace("\\\\", "/")
                if os.path.isdir(candidate) and candidate not in libraries:
                    libraries.append(candidate)
    return libraries


def find_tf2(steam: str) -> str:
    for library in steam_libraries(steam):
        tf = os.path.join(library, "steamapps", "common", "Team Fortress 2", "tf")
        if os.path.isdir(tf):
            return tf
    raise SystemExit(
        "Steam está, pero no encuentro Team Fortress 2 en ninguna de sus "
        "bibliotecas. ¿Está instalado?")


def open_archives(tf_dir: str) -> list[Vpk]:
    archives = []
    for name in sorted(os.listdir(tf_dir)):
        if name.endswith("_dir.vpk"):
            try:
                archives.append(Vpk(os.path.join(tf_dir, name)))
            except VpkError as error:
                print(f"  aviso: {name} no se pudo leer ({error})")
    if not archives:
        raise SystemExit(f"No hay ningún _dir.vpk en {tf_dir}")
    return archives


def extract(archives: list[Vpk], path: str, out_dir: str) -> bool:
    for archive in archives:
        if path in archive:
            destination = os.path.join(out_dir, path.replace("/", os.sep))
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            with open(destination, "wb") as handle:
                handle.write(archive.read(path))
            return True
    return False


def extract_class(archives: list[Vpk], tf_class: str, out_dir: str) -> bool:
    """Saca las piezas de una clase. Devuelve si al menos hay `.mdl` y `.vvd`."""
    got = set()
    for suffix in MODEL_SUFFIXES:
        path = f"models/player/{tf_class}{suffix}"
        if extract(archives, path, out_dir):
            got.add(suffix)
    for archive in archives:
        for path in archive.paths():
            lower = path.lower()
            if lower.startswith(f"materials/models/player/{tf_class}/") and \
                    lower.endswith((".vmt", ".vtf")):
                extract([archive], path, out_dir)
    return ".mdl" in got and ".vvd" in got


BLENDER_SCRIPT = r'''
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
mdl_path, glb_path = argv[0], argv[1]

# Blender Source Tools tiene que estar instalado y activado.
try:
    bpy.ops.preferences.addon_enable(module="io_scene_valvesource")
except Exception:
    pass
if not hasattr(bpy.ops.import_scene, "smd"):
    print("SIN_SOURCE_TOOLS")
    sys.exit(3)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.smd(filepath=mdl_path)
os.makedirs(os.path.dirname(glb_path), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB",
                          export_animations=True, export_apply=True)
print("CONVERTIDO", glb_path)
'''


def find_blender(explicit: str | None) -> str | None:
    if explicit:
        return explicit if os.path.exists(explicit) else None
    return shutil.which("blender")


def convert(blender: str, mdl_path: str, glb_path: str) -> bool:
    script_path = os.path.join(os.path.dirname(glb_path), "_convert.py")
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
    with open(script_path, "w", encoding="utf-8") as handle:
        handle.write(BLENDER_SCRIPT)
    try:
        result = subprocess.run(
            [blender, "--background", "--factory-startup", "--python", script_path,
             "--", mdl_path, glb_path],
            capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired) as error:
        print(f"  Blender falló: {error}")
        return False
    finally:
        if os.path.exists(script_path):
            os.remove(script_path)
    if "SIN_SOURCE_TOOLS" in result.stdout:
        raise SystemExit(
            "Blender está pero le falta Blender Source Tools, que es quien sabe "
            "leer los .mdl de Valve.\n"
            "  https://developer.valvesoftware.com/wiki/Blender_Source_Tools")
    if not os.path.exists(glb_path):
        print(f"  no salió el .glb; salida de Blender:\n{result.stdout[-800:]}")
        return False
    return True


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--steam", help="carpeta de Steam (la que tiene steamapps)")
    parser.add_argument("--blender", help="ejecutable de Blender")
    parser.add_argument("--extract-only", action="store_true",
                        help="solo saca los ficheros de Valve, sin convertir")
    parser.add_argument("--out", default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "..",
        "game", "assets", "models", "characters_tf2"))
    args = parser.parse_args(argv)

    out_dir = os.path.abspath(args.out)
    raw_dir = os.path.join(out_dir, "_raw")
    os.makedirs(raw_dir, exist_ok=True)

    tf_dir = find_tf2(find_steam(args.steam))
    print(f"TF2 encontrado en {tf_dir}")
    archives = open_archives(tf_dir)
    print(f"{len(archives)} archivos VPK abiertos")

    blender = None if args.extract_only else find_blender(args.blender)
    if not args.extract_only and blender is None:
        print("\nNo encuentro Blender. Se extraen los ficheros igualmente;\n"
              "para convertirlos instala Blender + Blender Source Tools y\n"
              "vuelve a ejecutar esto, o pásame la ruta con --blender.\n")

    done = 0
    for archetype, tf_class in CLASS_BY_ARCHETYPE.items():
        print(f"- {archetype} <- {tf_class}")
        if not extract_class(archives, tf_class, raw_dir):
            print(f"  no están las piezas de '{tf_class}' en tus VPK; se salta")
            continue
        if blender is None:
            done += 1
            continue
        mdl = os.path.join(raw_dir, "models", "player", f"{tf_class}.mdl")
        if convert(blender, mdl, os.path.join(out_dir, f"{archetype}.glb")):
            done += 1

    print(f"\n{done}/{len(CLASS_BY_ARCHETYPE)} listos en {out_dir}")
    if blender is None:
        print("Extraídos sin convertir: en el juego seguirán saliendo los de KayKit.")
    elif done:
        print("En el juego: abre la consola y escribe  : tf2 on")
    return 0 if done else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
