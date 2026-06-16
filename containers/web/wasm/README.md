# 42 Web UI — WASM (`42-web-wasm`)

Browser-based interface for the [42](https://github.com/ericstoneking/42) spacecraft
attitude and orbital dynamics simulation. The C source is compiled to WebAssembly
with Emscripten and visualized using Three.js — no native build required on the
client.

## Quick Start

```bash
cd containers/web
task wasm:build     # build the container image
task wasm:up        # start on port 8042
task services:message
```

Open <http://localhost:8042>. Click **Init** to load the WASM module, then **Run**
to start the simulation.

## Architecture

```
containers/web/wasm/
├── build.sh             Emscripten compilation script
├── server.js            Node.js static file server (port 8042)
├── shims/               C shim files for WASM export
│   ├── 42wasm_main.c       Empty main() replacement
│   ├── 42wasm_shims.c      OS function stubs (nanosleep, gettimeofday, etc.)
│   └── 42wasm_export.c     Exported API: sim_init, sim_step, sim_get_state
└── ui/                  Browser-side code
    ├── index.html          App shell: toolbar, grid layout, GLSL shaders
    ├── main.js             Orchestrator: TabManager, resize, dialogs, Worker wiring
    ├── sw.js               Service worker (session tracking)
    ├── styles.css          Catppuccin Mocha dark theme + IDE layout
    ├── core/
    │   ├── SimRunner.js       WASM module lifecycle (init/step/getState)
    │   ├── SimWorker.js       Web Worker — runs sim in background thread
    │   └── ServerSync.js      Client wrapper for /api/files/* REST API
    ├── viewer/
    │   ├── SceneManager.js    Three.js scene (Earth, atmosphere, starfield)
    │   ├── OrbitTrail.js      Ring-buffer orbit trajectory line
    │   └── SpacecraftView.js  SC marker with body-frame axes
    ├── widgets/
    │   ├── TabManager.js      Tab bar with closeable tabs for main content
    │   └── TreeView.js        Hierarchical collapsible tree widget
    └── panels/
        ├── ControlPanel.js    Toolbar controller (Init/Run/Pause/Step/Reset)
        ├── StatePanel.js      Live telemetry readout
        ├── ConfigPanel.js     ConsolePanel (log) + SimConfigPanel (config tab)
        ├── FileBrowser.js     TreeView-based file browser for MEMFS
        └── FileEditor.js      Text editor with line numbers + Save/Save&Run
```

No existing 42 source files are modified. The WASM build uses shim files that wrap
42's existing API, plus Emscripten compilation flags to produce a headless module.

## How It Works

### Container Build (Containerfile)

Three-stage multi-stage Docker build:

| Stage | Base | Purpose |
|---|---|---|
| `fortytwo-base` | `ubuntu:26.04` | Clones 42 from git, installs build tools |
| `fortytwo-build-wasm` | fortytwo-base | Installs Emscripten SDK 3.1.61 + Node.js 24, compiles 42 to WASM |
| `fortytwo-wasm` | `node:24-slim` | Minimal runtime serving built artifacts |

The 42 source is cloned from GitHub at build time (not copied from the host).
The build context is `containers/web/` — the Containerfile and compose.yaml
are at the parent level, shared with the native server variant.

### WASM Compilation (build.sh)

Emscripten compiles 34 C source files into a single WASM module:

- **16 core files** from `Source/` (42exec, 42dynamics, 42init, 42fsw, etc.)
- **12 kit files** from `Kit/Source/` (mathkit, orbkit, timekit, etc.)
- **3 autocode files** from `Source/AutoCode/`
- **3 shim files** from `containers/web/wasm/shims/`

GUI-only files are excluded: `42main.c`, `42gl.c`, `42glut.c`, `42glfw.c`,
`42gpgpu.c`, `glkit.c`.

Key Emscripten flags:

| Flag | Purpose |
|---|---|
| `MODULARIZE=1` | JS gets a `create42Module()` factory function |
| `INVOKE_RUN=0` | Don't call `main()` — JS calls `sim_init()` explicitly |
| `EXIT_RUNTIME=0` | Keep module alive between simulation steps |
| `FORCE_FILESYSTEM=1` | Enable Emscripten's MEMFS for file I/O |
| `ENVIRONMENT=web,worker` | Support both main thread and Web Worker |
| `STACK_SIZE=2097152` | 2 MB stack (42 uses deep call chains in dynamics) |
| `-D__linux__` | Satisfy OS guards in `timekit.c` |

Input data (`InOut/`, `Model/`) is bundled into `42.data` via `--preload-file`.
Large binary assets (`.ppm`, `.wings`, `.png`) are excluded to keep the
bundle manageable.

Build output:

```
out/
├── 42.js      95 KB    Module loader (factory function)
├── 42.wasm   551 KB    Compiled simulation
└── 42.data   326 MB    Preloaded InOut/ + Model/ data files
```

### C Shim Files

#### `42wasm_export.c` — Exported WASM API

The key interface between JavaScript and 42's C simulation:

```c
void   sim_init(void);           // Initialize simulation (calls InitSim + CmdInterpreter)
int    sim_step(void);           // Advance one time step (returns 1 when done)
double *sim_get_state(void);     // Returns pointer to SimStateSnapshot (16 doubles)
double sim_get_time(void);       // Current SimTime
double sim_get_stoptime(void);   // STOPTIME from Inp_Sim.txt
double sim_get_dtsim(void);      // DTSIM time step
long   sim_get_nsc(void);        // Number of spacecraft
```

`sim_get_state()` returns a pointer to a flat struct of 16 doubles, readable from
JavaScript via `HEAPF64`:

| Offset | Field | Description |
|---|---|---|
| 0 | SimTime | Current simulation time (sec) |
| 1-3 | PosN[3] | SC[0] position in N frame (m) |
| 4-6 | VelN[3] | SC[0] velocity in N frame (m/s) |
| 7-10 | qbn[4] | SC[0] body quaternion in N |
| 11-13 | svn[3] | Sun vector in N (unit) |
| 14 | Nlink | Number of comm links |
| 15 | Done | 1.0 if sim complete, else 0.0 |

#### `42wasm_shims.c` — OS Function Stubs

Functions that exist in 42's codebase but have no meaning in a WASM environment:

| Stub | Why |
|---|---|
| `nanosleep()` | Only used in REAL_TIME mode; WASM runs FAST_TIME |
| `gettimeofday()` | Mapped to `emscripten_get_now()` |
| `NOS3Time()` | Only used in NOS3_TIME mode |
| `AcFsw()` | Defined in `AcApp.c` which is not compiled for WASM |

### Browser Architecture

```
              ┌────────────────────────────────────────────┐
              │  index.html + main.js (orchestrator)       │
              ├────────┬───────────────────────────────────┤
              │ Left   │  TabManager (main content)        │
              │ Panel  │  ┌─────────┐ ┌──────────────┐    │
              │ ┌────┐ │  │ 3D View │ │ FileEditor × │    │
              │ │File│ │  │ (Three) │ │ (text tabs)  │    │
              │ │Brws│ │  └─────────┘ └──────────────┘    │
              │ ├────┤ ├──────────────────────────────────┤
              │ │Stat│ │  ConsolePanel (stdout/stderr)    │
              │ ├────┤ └──────────────────────────────────┘
              │ │Cfg │ │         ▲
              │ └────┘ │         │ postMessage
              └────────┘         ▼
                          ┌─────────────┐
                          │  SimWorker   │  ← Web Worker
                          │  (WASM sim) │
                          └─────────────┘
```

The simulation runs in a **Web Worker** so the UI stays responsive. The Worker
loads `42.js`/`42.wasm`, calls `sim_init()` and `sim_step()` in batches, and posts
state snapshots back to the main thread via `postMessage`.

**Worker message protocol:**

| Direction | Message | Description |
|---|---|---|
| Main → Worker | `{ type: 'INIT' }` | Load WASM, initialize simulation |
| Main → Worker | `{ type: 'RUN', stepsPerBatch: N }` | Run N steps per batch |
| Main → Worker | `{ type: 'PAUSE' }` | Pause simulation |
| Main → Worker | `{ type: 'STEP' }` | Single step |
| Main → Worker | `{ type: 'GET_FILES', paths: [...] }` | Read files from MEMFS |
| Main → Worker | `{ type: 'LIST_DIR', path }` | List directory contents in MEMFS |
| Main → Worker | `{ type: 'WRITE_FILE', path, content }` | Write content to MEMFS file |
| Worker → Main | `{ type: 'STATUS', status }` | `loading\|ready\|running\|paused\|done\|error` |
| Worker → Main | `{ type: 'STATE', state }` | Simulation state snapshot |
| Worker → Main | `{ type: 'FILES', files }` | Requested file contents |
| Worker → Main | `{ type: 'DIR_LIST', path, entries }` | Directory listing |
| Worker → Main | `{ type: 'FILE_WRITTEN', path, success }` | File write result |
| Worker → Main | `{ type: 'STDOUT', text }` | Simulation stdout |

**Three.js coordinate transform** — 42 uses ECI (Z-up N-frame); Three.js uses Y-up:

```
Three.x =  42.PosN[0]
Three.y =  42.PosN[2]
Three.z = -42.PosN[1]
```

### Server (server.js)

Node.js server with static file serving and per-session file sync API:

- Serves WASM artifacts from `/` and UI files from `/ui/`
- MIME types: `.wasm` → `application/wasm`, `.data` → `application/octet-stream`
- CORS headers for development
- `/version` endpoint returning the git commit hash
- `/api/files/*` REST API for per-session file persistence (see below)
- UUIDv4 session ID validation, path traversal protection
- Auto-populates new session directories with default InOut/ files
- Port 8042 (configurable via `PORT` env var)

## Task Commands

Run from `containers/web/`:

| Command | Description |
|---|---|
| `task wasm:build` | Build 42-wasm container image |
| `task wasm:rebuild` | Build from scratch (no cache) |
| `task wasm:up` | Start 42-wasm container |
| `task wasm:down` | Stop and remove 42-wasm container |
| `task wasm:logs` | Follow 42-wasm container logs |
| `task wasm:shell` | Open shell in running container |
| `task wasm:clean` | Remove container and image |

## Server-Side File Sync

By default, all file I/O happens in Emscripten's MEMFS (browser memory) and is lost
on page reload. The server provides per-session file persistence: each browser session
gets its own directory on the host, auto-populated with default `InOut/` files on
first access.

```
containers/web/wasm/sessions/
├── 2026-06-15T215341.130/
│   └── a1b2c3d4-e5f6-4789-abcd-ef0123456789/
│       └── InOut/      ← Session 1's files
├── 2026-06-15T220105.456/
│   └── f9e8d7c6-b5a4-4321-9876-543210fedcba/
│       └── InOut/      ← Session 2's files
└── ...
```

The `sessions/` directory is Docker-mounted to `/data/sessions` in the container.
Default `InOut/` files (from the 42 source tree) are bundled in the container image
at `/app/defaults/InOut/` and copied into each new session directory automatically.

When sync is active, the UI shows a green cloud icon in the toolbar and:
- **Save** in the file editor writes to both MEMFS and the session directory
- **Flush** button writes all MEMFS `/InOut/` files to the session directory
- Simulation outputs are auto-flushed when the sim completes

### File API

The server exposes REST endpoints under `/api/files/`. All endpoints except `status`
require a valid `X-Session-ID` header (UUIDv4 format, injected automatically by the
Service Worker).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/files/status` | Check if server sync is available |
| `GET` | `/api/files/list?dir=<rel>` | List directory contents |
| `GET` | `/api/files/read?path=<rel>` | Read a file |
| `POST` | `/api/files/write` | Write `{ path, content }` |
| `POST` | `/api/files/sync` | Bulk write `{ files: [{ path, content }] }` |

File paths are relative within the session's `InOut/` directory. The session ID
determines which directory is used: `/data/session/<uuid>/InOut/`.

## Known Limitations

- **Data bundle size**: `42.data` is ~326 MB due to bundled `InOut/` and `Model/`
  directories. Large binary textures (`.ppm`, `.png`) are excluded but the
  ephemeris, configuration, and geometry files are still substantial.
- **Single spacecraft**: The state export currently reads only `SC[0]`. Multi-SC
  support requires expanding `SimStateSnapshot`.
- **No World/ data**: The `World/` directory (~418 MB) is excluded from the WASM
  build to keep the bundle size manageable. Ephemeris data for planets beyond
  what's in `InOut/` is not available.
- **FAST_TIME only**: The WASM build runs in `FAST_TIME` mode. Real-time pacing
  is handled on the JavaScript side via batch sizing.
- **`exit()` in `FileOpen()`**: If a required data file is missing from the
  preloaded filesystem, 42 calls `exit()` which terminates the WASM module.
  All required files must be included in `--preload-file`.

## Dependencies

- [Docker](https://docs.docker.com/get-docker/) with Compose
- [Task](https://taskfile.dev/) (go-task) for build automation
- [Three.js](https://threejs.org/) v0.172.0 (loaded from CDN at runtime)

The Emscripten SDK, Node.js, and all build tools are installed inside the
container — no local toolchain required.
