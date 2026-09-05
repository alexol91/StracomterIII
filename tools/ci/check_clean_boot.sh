#!/usr/bin/env bash
# El juego debe arrancar sin un solo error ni aviso.
#
# El filtro es deliberadamente ESTRECHO y no un `grep -i error` a secas: eso
# casaría con nombres de prueba que contienen la palabra ("...without_error")
# y marcaría en rojo un build sano. Se buscan los prefijos que el motor emite
# de verdad al principio de línea.
set -euo pipefail

GODOT="${1:?falta la ruta a Godot}"
LOG="$(mktemp)"
trap 'rm -f "${LOG}"' EXIT

"${GODOT}" --headless --path game --quit-after 120 > "${LOG}" 2>&1 || true

PATTERN='^(ERROR|WARNING|SCRIPT ERROR|USER ERROR|USER WARNING):|ObjectDB instances were leaked|resources still in use'

if grep -qE "${PATTERN}" "${LOG}"; then
    echo "El arranque no está limpio:"
    grep -nE "${PATTERN}" "${LOG}"
    exit 1
fi

echo "Arranque limpio: ni errores, ni avisos, ni fugas."
