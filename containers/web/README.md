# 42 Web UI

Browser-based interface for the [42](https://github.com/ericstoneking/42) spacecraft
attitude and orbital dynamics simulation. Two approaches, one Containerfile:

```
containers/web/
├── Containerfile        Multi-stage build for both services
├── compose.yaml         42-web-wasm (:8042) + 42-web-server (:8043)
├── Taskfile.yaml        task wasm:* and task server:*
├── ui/                  Browser-side code (shared by both services)
│   ├── index.html          Main HTML entry point
│   ├── main.js             Central orchestrator
│   ├── styles.css          Catppuccin-themed styles
│   ├── core/               SimWorker, ServerBackend, ServerSync
│   ├── panels/             FileBrowser, FileEditor, ControlPanel, etc.
│   ├── viewer/             Three.js 3D viewer
│   └── widgets/            TabManager, TreeView
├── wasm/                WASM-specific: build script, shims, static file server
│   ├── build.sh            Emscripten compilation script
│   ├── server.js           Node.js static file server
│   └── shims/              C shim files for WASM export
└── server/              Native-specific: process manager server
    └── server.js           Node.js server with 42 process management
```

## Quick Start

```bash
cd containers/web
task wasm:build   && task wasm:up       # WASM on http://localhost:8042
task server:build && task server:up     # Native on http://localhost:8043
task services:message                   # show URLs
```

## Services

| Service | Port | Description |
|---|---|---|
| `42-web-wasm` | 8042 | Simulation runs client-side in the browser (WASM) |
| `42-web-server` | 8043 | Simulation runs server-side natively |

Both services share the same UI (`ui/`).

See [wasm/README.md](wasm/README.md) and [server/README.md](server/README.md) for details.
