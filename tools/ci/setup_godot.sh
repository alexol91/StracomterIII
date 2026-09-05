#!/usr/bin/env bash
# Descarga Godot y sus plantillas de exportación, si no están ya cacheadas.
# Uso: setup_godot.sh <version>
set -euo pipefail

VERSION="${1:?falta la versión de Godot}"
BASE="https://github.com/godotengine/godot-builds/releases/download/${VERSION}-stable"
TEMPLATES_DIR="${HOME}/.local/share/godot/export_templates/${VERSION}.stable"

if [ ! -x "${HOME}/godot/godot" ]; then
    mkdir -p "${HOME}/godot"
    cd "${HOME}/godot"
    curl -fsSL --retry 5 --retry-all-errors \
        -o godot.zip "${BASE}/Godot_v${VERSION}-stable_linux.x86_64.zip"
    unzip -q -o godot.zip
    mv "Godot_v${VERSION}-stable_linux.x86_64" godot
    chmod +x godot
fi

if [ ! -d "${TEMPLATES_DIR}" ]; then
    mkdir -p "$(dirname "${TEMPLATES_DIR}")"
    cd /tmp
    curl -fsSL --retry 5 --retry-all-errors \
        -o templates.tpz "${BASE}/Godot_v${VERSION}-stable_export_templates.tpz"
    unzip -q -o templates.tpz
    mv templates "${TEMPLATES_DIR}"
fi
