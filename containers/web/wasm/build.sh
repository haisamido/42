#!/usr/bin/env bash
#
# build.sh — Compile 42 to WebAssembly using Emscripten
#
# Usage:
#   cd containers/web/wasm
#   bash build.sh
#
# Requires: emcc (Emscripten) on PATH
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
OUT_DIR="${SCRIPT_DIR}/out"

SRC="${ROOT_DIR}/Source"
KIT="${ROOT_DIR}/Kit/Source"
AUTO="${ROOT_DIR}/Source/AutoCode"
SHIMS="${SCRIPT_DIR}/shims"
INC="${ROOT_DIR}/Include"
KITINC="${ROOT_DIR}/Kit/Include"

echo "=== 42 WASM Build ==="
echo "Root:   ${ROOT_DIR}"
echo "Output: ${OUT_DIR}"

# Verify emcc is available
if ! command -v emcc &>/dev/null; then
    echo "ERROR: emcc not found. Source the Emscripten SDK first:"
    echo "  source /opt/emsdk/emsdk_env.sh"
    exit 1
fi
echo "emcc:   $(emcc --version | head -1)"

# Create output directory
mkdir -p "${OUT_DIR}"

# ---------------------------------------------------------------------------
# Source file lists (from Makefile lines 218-233, excluding GUI files)
# ---------------------------------------------------------------------------

# Core 42 objects (42OBJ minus 42main.c — replaced by shims/42wasm_main.c)
CORE_SOURCES=(
    "${SRC}/42exec.c"
    "${SRC}/42actuators.c"
    "${SRC}/42cmd.c"
    "${SRC}/42commlink.c"
    "${SRC}/42dynamics.c"
    "${SRC}/42environs.c"
    "${SRC}/42ephem.c"
    "${SRC}/42fsw.c"
    "${SRC}/42init.c"
    "${SRC}/42ipc.c"
    "${SRC}/42jitter.c"
    "${SRC}/42joints.c"
    "${SRC}/42optics.c"
    "${SRC}/42perturb.c"
    "${SRC}/42report.c"
    "${SRC}/42sensors.c"
)

# Kit objects (KITOBJ — all 12)
KIT_SOURCES=(
    "${KIT}/dcmkit.c"
    "${KIT}/envkit.c"
    "${KIT}/fswkit.c"
    "${KIT}/iokit.c"
    "${KIT}/mathkit.c"
    "${KIT}/meshkit.c"
    "${KIT}/nrlmsise00kit.c"
    "${KIT}/orbkit.c"
    "${KIT}/radbeltkit.c"
    "${KIT}/sigkit.c"
    "${KIT}/sphkit.c"
    "${KIT}/timekit.c"
)

# AutoCode objects (AUTOOBJ — all 3)
AUTO_SOURCES=(
    "${AUTO}/WriteAcToCsv.c"
    "${AUTO}/WriteScToCsv.c"
    "${AUTO}/TxRxIPC.c"
)

# WASM shim files (replace 42main.c + add stubs + export API)
SHIM_SOURCES=(
    "${SHIMS}/42wasm_main.c"
    "${SHIMS}/42wasm_shims.c"
    "${SHIMS}/42wasm_export.c"
)

# Combine all sources
ALL_SOURCES=(
    "${CORE_SOURCES[@]}"
    "${KIT_SOURCES[@]}"
    "${AUTO_SOURCES[@]}"
    "${SHIM_SOURCES[@]}"
)

echo ""
echo "Compiling ${#ALL_SOURCES[@]} source files..."

# ---------------------------------------------------------------------------
# Emscripten compilation
# ---------------------------------------------------------------------------

emcc "${ALL_SOURCES[@]}" \
    -include "${SHIMS}/42wasm_unbuf.h" \
    -I "${INC}" \
    -I "${KITINC}" \
    -I "${KIT}" \
    -std=gnu11 \
    -O2 \
    -Wno-deprecated \
    -D__linux__ \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=create42Module \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s FORCE_FILESYSTEM=1 \
    -s ENVIRONMENT=web,worker \
    -s INVOKE_RUN=0 \
    -s EXIT_RUNTIME=0 \
    -s EXPORTED_FUNCTIONS='["_main","_sim_init","_sim_step","_sim_get_state","_sim_get_time","_sim_get_stoptime","_sim_get_dtsim","_sim_get_nsc"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","FS","HEAPF64","getValue"]' \
    -s STACK_SIZE=2097152 \
    -s INITIAL_MEMORY=67108864 \
    --preload-file "${ROOT_DIR}/InOut@/InOut" \
    --preload-file "${ROOT_DIR}/Model@/Model" \
    --exclude-file "*.ppm" \
    --exclude-file "*.wings" \
    --exclude-file "*.png" \
    --exclude-file "*.xcf" \
    --exclude-file "*.dSYM" \
    -o "${OUT_DIR}/42.js"

echo ""
echo "=== Build complete ==="
ls -lh "${OUT_DIR}"/42.*
echo ""
echo "Files:"
echo "  ${OUT_DIR}/42.js    — Module loader"
echo "  ${OUT_DIR}/42.wasm  — Compiled simulation"
echo "  ${OUT_DIR}/42.data  — Preloaded data files (InOut/ + Model/ + World/)"
