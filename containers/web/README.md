# 42 Web UI

Browser-based interface for the [42](https://github.com/ericstoneking/42) spacecraft
attitude and orbital dynamics simulation. Two approaches, one Containerfile:

```
containers/web/
├── Containerfile        Multi-stage build for both services
├── compose.yaml         42-web-wasm (:8042) + 42-web-server (:8043)
├── Taskfile.yaml        task wasm:* and task server:*
├── 42/                  Override directory (user-specific, gitignored)
│   ├── Source/             Build-time: custom C source patches
│   ├── InOut/              Runtime: override InOut config files
│   ├── Model/              Runtime: additional Model files
│   └── World/              Runtime: additional World textures
├── ui/                  Browser-side code (shared by both services)
│   ├── index.html          Main HTML entry point
│   ├── main.js             Central orchestrator
│   ├── styles.css          Catppuccin-themed styles
│   ├── core/               SimWorker, ServerBackend, ServerSync, StateNormalizer
│   ├── panels/             FileBrowser, FileEditor, ControlPanel, etc.
│   ├── viewer/             42gl.js (3D + Map), PpmLoader, SceneManager
│   └── widgets/            TabManager, TreeView
├── wasm/                WASM-specific: build script, shims, static file server
│   ├── build.sh            Emscripten compilation script
│   ├── server.js           Node.js static file server
│   └── shims/              C shim files for WASM export (42wasm_export.c)
└── server/              Native-specific: process manager server
    ├── server.js           Node.js server with IPC, SSE, process management
    └── sessions/           Per-session working directories (gitignored)
```

## Quick Start

```bash
cd containers/web
task wasm:build   && task wasm:up       # WASM on http://localhost:8042
task server:build && task server:up     # Native on http://localhost:8043
task services:message                   # show URLs
task rebuild                            # full rebuild both (no cache)
```

## Services

| Service | Port | Description |
|---|---|---|
| `42-web-wasm` | 8042 | Simulation runs client-side in the browser (WASM) |
| `42-web-server` | 8043 | Simulation runs server-side natively, IPC state via SSE |

Both services share the same UI (`ui/`) and mount `World/` for planet textures.

Server mode uses 42's built-in IPC TCP sockets for real-time state streaming
(configured via `Inp_IPC.txt` with SC and Orb prefixes). State is pushed to
the browser via SSE, eliminating file-based polling.

## Sample Scenarios

Six sample scenarios are available from the toolbar dropdown: InOut (default),
Demo, Standalone, Tx, LunarComm, and Rx. Selecting a scenario copies its files
into the active session working directory.

## Sessions

Server mode uses per-session working directories to isolate simulation state.
Each server start creates a timestamped session under `server/sessions/`
(or `SESSION_DIR` in Docker). The host's `InOut/`, `Model/`, and `World/`
directories are never modified — `Model/` and `World/` are mounted read-only,
and `InOut/` is copied from samples into the session at startup.

## Override Directory

Place files in `42/` to customize the build or runtime behavior:

- `42/Source/*.c` — compiled into the 42 binary/WASM at build time
- `42/InOut/*` — merged over InOut/ at container startup (server mode)
- `42/Model/*` — merged over Model/ at container startup (server mode)
- `42/World/*` — merged over World/ at container startup (server mode)

The `42/` directory contents are gitignored (only `.gitkeep` files are tracked).

See [wasm/README.md](wasm/README.md) and [server/README.md](server/README.md) for details.
