# 42 Web UI — Native Server (`42-web-server`)

Run 42 natively inside a container with a web UI thin client.

## Architecture

```
Browser (shared UI)             Container (42-web-server :8043)
┌──────────────────┐            ┌──────────────────────┐
│  File Editor     │  REST/SSE  │  Node.js server      │
│  Console         │◄──────────►│  ├── /api/files/*     │
│  Controls        │            │  ├── /api/sim/*        │
│  3D Viewer       │            │  └── SSE event stream  │
└──────────────────┘            │                      │
                                │  42 (native Linux)   │
                                │  └── InOut/ on disk   │
                                └──────────────────────┘
```

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/sim/status` | Current simulation status |
| `POST` | `/api/sim/start` | Start the 42 process |
| `POST` | `/api/sim/stop` | Stop the 42 process |
| `GET` | `/api/sim/events` | SSE stream (stdout, stderr, status) |
| `GET` | `/api/files/status` | File API availability |
| `GET` | `/api/files/list?dir=` | List InOut/ directory contents |
| `GET` | `/api/files/read?path=` | Read a file from InOut/ |
| `POST` | `/api/files/write` | Write `{ path, content }` to InOut/ |

## Compared to WASM (`42-web-wasm`)

| | `42-web-wasm` | `42-web-server` |
|---|---|---|
| Port | 8042 | 8043 |
| Simulation runs | Client (browser) | Server (container) |
| File I/O | MEMFS + sync bridge | Direct filesystem |
| Performance | WASM overhead | Native speed |
| Data bundle | ~326 MB in browser | On disk |
| UI | `wasm/ui/` | Same (`wasm/ui/`) |
