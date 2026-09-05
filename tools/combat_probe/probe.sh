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

"${GODOT}" --headless --path "${ROOT}/game" res://_probe_tmp.tscn
