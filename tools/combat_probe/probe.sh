#!/usr/bin/env bash
# Sonda de combate. Ver tools/combat_probe/probe.gd.
#
#   tools/combat_probe/probe.sh <ruta-a-godot>
#
# El script y su escena se copian dentro de `game/` porque Godot solo acepta
# rutas `res://`, y se borran al terminar: dejarlos ahí los metería en el
# ejecutable exportado.
set -euo pipefail

GODOT="${1:?falta la ruta a Godot}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/game/_probe_tmp.gd"
SCENE="${ROOT}/game/_probe_tmp.tscn"

cleanup() { rm -f "${SCRIPT}" "${SCRIPT}.uid" "${SCENE}"; }
trap cleanup EXIT

cp "${ROOT}/tools/combat_probe/probe.gd" "${SCRIPT}"
cat > "${SCENE}" <<'TSCN'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://_probe_tmp.gd" id="1"]

[node name="CombatProbe" type="Node"]
script = ExtResource("1")
TSCN

# `--fixed-fps 60` es lo que convierte la sonda en un instrumento. Sin él, el
# delta de `_process` es el tiempo real del frame, así que el planificador de
# IA decide en instantes distintos en cada ejecución: con el MISMO código se
# midieron entre 26 y 87 disparos enemigos. Con el paso fijo y la semilla fija
# del encuentro, dos ejecuciones se parecen.
# `PROBE_FLOOR` / `PROBE_ZONE` eligen dónde se juega (por defecto 3-5, la
# primera zona con MiniBoss). La azotea se prueba con PROBE_FLOOR=9 PROBE_ZONE=1.
PROBE_FLOOR="${PROBE_FLOOR:-}" PROBE_ZONE="${PROBE_ZONE:-}" \
    "${GODOT}" --headless --fixed-fps 60 --path "${ROOT}/game" res://_probe_tmp.tscn
