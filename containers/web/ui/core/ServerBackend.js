/**
 * ServerBackend.js — Worker-compatible backend for native 42 server mode.
 *
 * Provides the same postMessage/onmessage interface as SimWorker.js,
 * but routes operations through REST API endpoints and SSE for real-time
 * events. This allows main.js to use the same code paths regardless of
 * whether the simulation runs client-side (WASM) or server-side (native).
 *
 * Message protocol is identical to SimWorker.js:
 *
 * Inbound (postMessage):
 *   { type: 'INIT' }                    — Check server, signal ready
 *   { type: 'RUN',  stepsPerBatch: N }  — POST /api/sim/start
 *   { type: 'PAUSE' }                   — POST /api/sim/stop
 *   { type: 'STEP' }                    — (not supported in server mode)
 *   { type: 'GET_FILES', paths: [...] } — GET /api/files/read per path
 *   { type: 'LIST_DIR', path: '...' }   — GET /api/files/list
 *   { type: 'WRITE_FILE', path, content }— POST /api/files/write
 *
 * Outbound (onmessage):
 *   { type: 'STATUS', status }           — 'loading'|'ready'|'running'|'done'|'error'
 *   { type: 'STATE',  state }            — Simulation state (polled from /api/sim/state)
 *   { type: 'FILES',  files }            — Requested file contents
 *   { type: 'DIR_LIST', path, entries }  — Directory listing
 *   { type: 'FILE_WRITTEN', path, success, error? }
 *   { type: 'STDOUT', text }             — Simulation stdout (via SSE)
 *   { type: 'STDERR', text }             — Simulation stderr (via SSE)
 */

export class ServerBackend {
   constructor() {
      this.onmessage = null;
      this.onerror = null;
      this._listeners = new Map();
      this._eventSource = null;
      this._statePoller = null;
      this._pollInterval = 500; /* ms between state polls, adjusted by speed slider */
   }

   /* ------------------------------------------------------------------ */
   /* Worker-compatible event interface                                   */
   /* ------------------------------------------------------------------ */

   addEventListener(type, handler) {
      if (!this._listeners.has(type)) {
         this._listeners.set(type, new Set());
      }
      this._listeners.get(type).add(handler);
   }

   removeEventListener(type, handler) {
      const set = this._listeners.get(type);
      if (set) set.delete(handler);
   }

   _emit(data) {
      const event = { data };
      if (this.onmessage) this.onmessage(event);
      const set = this._listeners.get('message');
      if (set) {
         for (const fn of set) fn(event);
      }
   }

   /* ------------------------------------------------------------------ */
   /* Worker-compatible postMessage dispatch                              */
   /* ------------------------------------------------------------------ */

   postMessage(msg) {
      switch (msg.type) {
         case 'INIT':       this._init(); break;
         case 'RUN':        this._startSim(); break;
         case 'PAUSE':      this._stopSim(); break;
         case 'STEP':       /* not supported */ break;
         case 'SET_SPEED':  this._setSpeed(msg.stepsPerBatch || 100); break;
         case 'GET_FILES':    this._getFiles(msg.paths || []); break;
         case 'LIST_DIR':     this._listDir(msg.path || '/InOut'); break;
         case 'WRITE_FILE':   this._writeFile(msg.path, msg.content); break;
         case 'LIST_SAMPLES': this._listSamples(); break;
         case 'LOAD_SAMPLE':  this._loadSample(msg.name); break;
      }
   }

   terminate() {
      this._stopStatePoller();
      if (this._eventSource) {
         this._eventSource.close();
         this._eventSource = null;
      }
   }

   /* ------------------------------------------------------------------ */
   /* Path conversion: MEMFS paths → server-relative paths               */
   /* ------------------------------------------------------------------ */

   /** Convert MEMFS absolute path to relative path for the server file API.
    *  /InOut/foo → InOut/foo, /Model/bar → Model/bar */
   _toRelPath(memfsPath) {
      return memfsPath.replace(/^\//, '');
   }

   /* ------------------------------------------------------------------ */
   /* INIT — verify server is reachable, signal ready                    */
   /* ------------------------------------------------------------------ */

   async _init() {
      this._emit({ type: 'STATUS', status: 'loading' });
      try {
         const res = await fetch('/api/files/status');
         if (res.ok) {
            this._emit({ type: 'STATUS', status: 'ready' });
         } else {
            this._emit({ type: 'STDERR', text: 'Server file API not available' });
            this._emit({ type: 'STATUS', status: 'error' });
         }
      } catch (e) {
         this._emit({ type: 'STDERR', text: 'Server connection failed: ' + e.message });
         this._emit({ type: 'STATUS', status: 'error' });
      }
   }

   /* ------------------------------------------------------------------ */
   /* Simulation control via REST + SSE                                   */
   /* ------------------------------------------------------------------ */

   async _startSim() {
      try {
         /* Connect SSE BEFORE starting the sim to avoid missing output */
         await this._connectSSE();

         const res = await fetch('/api/sim/start', { method: 'POST' });
         const data = await res.json();
         if (!data.success) {
            this._emit({ type: 'STDERR', text: data.error || 'Failed to start simulation' });
         }
      } catch (e) {
         this._emit({ type: 'STDERR', text: 'Start failed: ' + e.message });
      }
   }

   async _stopSim() {
      try {
         const res = await fetch('/api/sim/stop', { method: 'POST' });
         const data = await res.json();
         if (!data.success) {
            this._emit({ type: 'STDERR', text: data.error || 'Stop failed' });
         }
      } catch (e) {
         this._emit({ type: 'STDERR', text: 'Stop failed: ' + e.message });
      }
   }

   /** Connect to SSE stream. Returns a promise that resolves when connected. */
   _connectSSE() {
      return new Promise((resolve) => {
         if (this._eventSource) this._eventSource.close();
         this._eventSource = new EventSource('/api/sim/events');

         this._eventSource.addEventListener('open', () => resolve(), { once: true });

         this._eventSource.addEventListener('status', (e) => {
            try {
               const data = JSON.parse(e.data);
               if (data.status === 'running') {
                  /* Start file-based polling as fallback;
                     IPC state arrives via SSE 'state' events if available */
                  this._startStatePoller();
               } else {
                  this._stopStatePoller();
                  /* Fetch final state on completion */
                  if (data.status === 'done') this._fetchState();
               }
               this._emit({ type: 'STATUS', status: data.status });
            } catch (err) { /* ignore parse errors */ }
         });

         /* IPC-based state: server pushes parsed state via SSE */
         this._eventSource.addEventListener('state', (e) => {
            try {
               const state = JSON.parse(e.data);
               /* Stop polling — IPC is delivering state */
               if (this._statePoller) this._stopStatePoller();
               this._emit({ type: 'STATE', state });
            } catch (err) { /* ignore */ }
         });

         this._eventSource.addEventListener('stdout', (e) => {
            try {
               const data = JSON.parse(e.data);
               this._emit({ type: 'STDOUT', text: data.text });
            } catch (err) { /* ignore */ }
         });

         this._eventSource.addEventListener('stderr', (e) => {
            try {
               const data = JSON.parse(e.data);
               this._emit({ type: 'STDERR', text: data.text });
            } catch (err) { /* ignore */ }
         });

         this._eventSource.onerror = () => {
            resolve(); /* resolve on error too to avoid hanging */
         };
      });
   }

   /* ------------------------------------------------------------------ */
   /* State polling (fetches /api/sim/state while simulation is running)  */
   /* ------------------------------------------------------------------ */

   _startStatePoller() {
      this._stopStatePoller();
      this._statePoller = setInterval(() => this._fetchState(), this._pollInterval);
   }

   _stopStatePoller() {
      if (this._statePoller) {
         clearInterval(this._statePoller);
         this._statePoller = null;
      }
   }

   /** Map speed slider value (1–1000) to polling interval.
    *  speed 1 → 2000ms, speed 100 → 500ms, speed 1000 → 50ms */
   _setSpeed(speed) {
      this._pollInterval = Math.max(50, Math.round(50000 / speed));
      /* Restart poller with new interval if currently polling */
      if (this._statePoller) {
         this._startStatePoller();
      }
   }

   async _fetchState() {
      try {
         const res = await fetch('/api/sim/state');
         if (res.ok) {
            const state = await res.json();
            this._emit({ type: 'STATE', state });
         }
      } catch (e) { /* ignore fetch errors during polling */ }
   }

   /* ------------------------------------------------------------------ */
   /* File operations via REST API                                        */
   /* ------------------------------------------------------------------ */

   async _listDir(dirPath) {
      const relDir = this._toRelPath(dirPath);
      try {
         const res = await fetch(`/api/files/list?dir=${encodeURIComponent(relDir)}`);
         if (res.ok) {
            const data = await res.json();
            this._emit({
               type: 'DIR_LIST',
               path: dirPath,
               entries: data.entries || [],
            });
         } else {
            this._emit({ type: 'DIR_LIST', path: dirPath, entries: [] });
         }
      } catch (e) {
         this._emit({ type: 'DIR_LIST', path: dirPath, entries: [], error: e.message });
      }
   }

   async _getFiles(paths) {
      const files = {};
      for (const p of paths) {
         const relPath = this._toRelPath(p);
         try {
            const res = await fetch(`/api/files/read?path=${encodeURIComponent(relPath)}`);
            if (res.ok) {
               const data = await res.json();
               files[p] = data.content;
            } else {
               files[p] = null;
            }
         } catch (e) {
            files[p] = null;
         }
      }
      this._emit({ type: 'FILES', files });
   }

   async _writeFile(memfsPath, content) {
      const relPath = this._toRelPath(memfsPath);
      try {
         const res = await fetch('/api/files/write', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: relPath, content }),
         });
         const data = await res.json();
         this._emit({
            type: 'FILE_WRITTEN',
            path: memfsPath,
            success: data.success === true,
            error: data.error,
         });
      } catch (e) {
         this._emit({
            type: 'FILE_WRITTEN',
            path: memfsPath,
            success: false,
            error: e.message,
         });
      }
   }

   /* ------------------------------------------------------------------ */
   /* Sample scenario management via REST API                             */
   /* ------------------------------------------------------------------ */

   async _listSamples() {
      try {
         const res = await fetch('/api/samples/list');
         if (res.ok) {
            const data = await res.json();
            this._emit({ type: 'SAMPLES_LIST', samples: data.samples || [] });
         } else {
            this._emit({ type: 'SAMPLES_LIST', samples: [] });
         }
      } catch (e) {
         this._emit({ type: 'SAMPLES_LIST', samples: [], error: e.message });
      }
   }

   async _loadSample(name) {
      try {
         const res = await fetch('/api/samples/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
         });
         const data = await res.json();
         this._emit({
            type: 'SAMPLE_LOADED',
            name,
            success: data.success === true,
            error: data.error,
         });
         if (data.success) {
            this._emit({ type: 'STATUS', status: 'ready' });
         }
      } catch (e) {
         this._emit({ type: 'SAMPLE_LOADED', name, success: false, error: e.message });
      }
   }
}
