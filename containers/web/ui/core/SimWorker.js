/**
 * SimWorker.js — Web Worker that runs 42 simulation in a background thread.
 *
 * Message protocol:
 *
 * Main → Worker:
 *   { type: 'INIT' }                    — Load WASM and initialize simulation
 *   { type: 'RUN',  stepsPerBatch: N }  — Run N steps per batch, post state
 *   { type: 'PAUSE' }                   — Pause simulation
 *   { type: 'STEP' }                    — Single step
 *   { type: 'GET_FILES', paths: [...] } — Read files from MEMFS
 *   { type: 'LIST_DIR', path: '...' }  — List files in a MEMFS directory
 *
 * Worker → Main:
 *   { type: 'STATUS', status: '...' }   — 'loading'|'ready'|'running'|'paused'|'done'|'error'
 *   { type: 'STATE',  state: {...} }    — Simulation state snapshot
 *   { type: 'FILES',  files: {...} }    — Requested file contents
 *   { type: 'DIR_LIST', path, entries } — Directory listing
 *   { type: 'STDOUT', text: '...' }     — Simulation stdout output
 *   { type: 'STDERR', text: '...' }     — Simulation stderr output
 */

/* globals: importScripts, self, create42Module */

let mod = null;
let running = false;
let stepsPerBatch = 100;

function postStatus(status) {
   self.postMessage({ type: 'STATUS', status });
}

function getState() {
   const ptr = mod._sim_get_state();
   const f64 = new Float64Array(mod.HEAPF64.buffer, ptr, 16);
   return {
      simTime: f64[0],
      posN:    [f64[1], f64[2], f64[3]],
      velN:    [f64[4], f64[5], f64[6]],
      qbn:     [f64[7], f64[8], f64[9], f64[10]],
      svn:     [f64[11], f64[12], f64[13]],
      nlink:   f64[14],
      done:    f64[15] > 0.5,
   };
}

async function init() {
   postStatus('loading');

   /* Load the Emscripten-generated module */
   importScripts('../../42.js');

   mod = await create42Module({
      locateFile: (path) => '../../' + path,
      print:    (text) => self.postMessage({ type: 'STDOUT', text }),
      printErr: (text) => self.postMessage({ type: 'STDERR', text }),
   });

   /* Initialize simulation */
   mod._sim_init();
   postStatus('ready');
}

function runBatch() {
   if (!running) return;

   let done = 0;
   for (let i = 0; i < stepsPerBatch && !done; i++) {
      done = mod._sim_step();
   }

   /* Post current state */
   self.postMessage({ type: 'STATE', state: getState() });

   if (done) {
      running = false;
      postStatus('done');
   } else {
      /* Yield to allow message processing, then continue */
      setTimeout(runBatch, 0);
   }
}

function singleStep() {
   if (!mod) return;
   const done = mod._sim_step();
   self.postMessage({ type: 'STATE', state: getState() });
   if (done) {
      postStatus('done');
   }
}

function listDir(dirPath) {
   try {
      const entries = mod.FS.readdir(dirPath)
         .filter(name => name !== '.' && name !== '..')
         .map(name => {
            const full = dirPath.replace(/\/$/, '') + '/' + name;
            let isDir = false;
            try { isDir = mod.FS.isDir(mod.FS.stat(full).mode); } catch (e) { /* */ }
            return { name, isDir };
         })
         .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
         });
      self.postMessage({ type: 'DIR_LIST', path: dirPath, entries });
   } catch (e) {
      self.postMessage({ type: 'DIR_LIST', path: dirPath, entries: [], error: e.message });
   }
}

function getFiles(paths) {
   const files = {};
   for (const p of paths) {
      try {
         files[p] = mod.FS.readFile(p, { encoding: 'utf8' });
      } catch (e) {
         files[p] = null;
      }
   }
   self.postMessage({ type: 'FILES', files });
}

self.onmessage = async function (e) {
   const msg = e.data;

   switch (msg.type) {
      case 'INIT':
         try {
            await init();
         } catch (err) {
            self.postMessage({ type: 'STDERR', text: 'Init failed: ' + err.message });
            postStatus('error');
         }
         break;

      case 'RUN':
         if (!mod) return;
         stepsPerBatch = msg.stepsPerBatch || 100;
         running = true;
         postStatus('running');
         runBatch();
         break;

      case 'PAUSE':
         running = false;
         postStatus('paused');
         break;

      case 'STEP':
         singleStep();
         break;

      case 'GET_FILES':
         if (mod) getFiles(msg.paths || []);
         break;

      case 'LIST_DIR':
         if (mod) listDir(msg.path || '/InOut');
         break;
   }
};
