#!/usr/bin/env bash
# Captura pantallas del juego a PNG. Ver tools/screenshots/capture.gd.
#
#   tools/screenshots/capture.sh <ruta-a-godot> [directorio-de-salida]
#
# El script se copia dentro de `game/` porque `--script` solo acepta rutas
# `res://`, y se borra al terminar: dejarlo ahí lo convertiría en parte del
# proyecto exportado.
set -euo pipefail

GODOT="${1:?falta la ruta a Godot}"
OUT="${2:-$(pwd)/screenshots}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMP="${ROOT}/game/_capture_tmp.gd"

cleanup() { rm -f "${TEMP}" "${TEMP}.uid"; }
trap cleanup EXIT

cp "${ROOT}/tools/screenshots/capture.gd" "${TEMP}"
mkdir -p "${OUT}"

run() {
    SHOT_OUT="${OUT}" SHOT_CHUTAOS="$1" xvfb-run -a "${GODOT}" \
        --path "${ROOT}/game" --rendering-driver opengl3 --resolution 1280x720 \
        --script res://_capture_tmp.gd 2>&1 | grep -E '\.png$' || true
}

run 0
run 1
echo "Capturas en ${OUT}"
