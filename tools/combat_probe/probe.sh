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
# Un error de sintaxis en el script de la sonda no da un fallo: da un CUELGUE.
# La escena carga sin script, nadie llama a `quit()` y el proceso se queda
# girando al 100 % de CPU sin imprimir nada. Ha pasado tres veces. El tope de
# tiempo acota el cuelgue y el `grep` de abajo lo NOMBRA — que es la
# diferencia entre "la sonda falla" y "la sonda no arrancó".
#
# El pre-vuelo con `--check-only --script` no sirve: en ese modo el motor no
# registra los autoloads como identificadores globales y toda referencia a
# `GameState` o `AIScheduler` se denuncia como error inexistente.
LOG="$(mktemp)"
trap 'rm -f "${SCRIPT}" "${SCRIPT}.uid" "${SCENE}" "${LOG}"' EXIT
# `timeout` es de coreutils y macOS no lo trae: sin esto la sonda moría con
# «timeout: command not found» y código 127 en cualquier Mac. Se usa si está
# —también `gtimeout`, que es como lo instala Homebrew— y, si no, la sonda
# corre igual: lo que se pierde es el tope que acota un cuelgue, no la medida.
LIMIT=""
if command -v timeout >/dev/null 2>&1; then
    LIMIT="timeout 600"
elif command -v gtimeout >/dev/null 2>&1; then
    LIMIT="gtimeout 600"
fi

set +e
${LIMIT} "${GODOT}" --headless --fixed-fps 60 --path "${ROOT}/game" res://_probe_tmp.tscn 2>&1 | tee "${LOG}"
status=${PIPESTATUS[0]}
set -e
if grep -qE "Parse Error|Compile Error|Compilation failed|Failed to load script" "${LOG}"; then
    echo "[sonda] el script de la sonda NO COMPILA: el error está arriba." >&2
    exit 1
fi
if [ "${status}" -eq 124 ]; then
    echo "[sonda] la sonda no terminó en 600 s: se ha quedado colgada." >&2
    exit 1
fi
exit "${status}"
