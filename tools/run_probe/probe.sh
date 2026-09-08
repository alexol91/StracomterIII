#!/usr/bin/env bash
# Sonda de partida completa. Ver tools/run_probe/probe.gd.
#
#   tools/run_probe/probe.sh <ruta-a-godot>
#
# El script y su escena se copian dentro de `game/` porque Godot solo acepta
# rutas `res://`, y se borran al terminar: dejarlos ahí los metería en el
# ejecutable exportado.
set -euo pipefail

GODOT="${1:?falta la ruta a Godot}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT}/game/_run_probe_tmp.gd"
SCENE="${ROOT}/game/_run_probe_tmp.tscn"

cleanup() { rm -f "${SCRIPT}" "${SCRIPT}.uid" "${SCENE}"; }
trap cleanup EXIT

cp "${ROOT}/tools/run_probe/probe.gd" "${SCRIPT}"
cat > "${SCENE}" <<'TSCN'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://_run_probe_tmp.gd" id="1"]

[node name="RunProbe" type="Node"]
script = ExtResource("1")
TSCN

# Paso fijo por lo mismo que en la sonda de combate: sin él, cuántas oleadas
# ha soltado el director cuando la sonda limpia depende del reloj de pared.
"${GODOT}" --headless --fixed-fps 60 --path "${ROOT}/game" res://_run_probe_tmp.tscn
