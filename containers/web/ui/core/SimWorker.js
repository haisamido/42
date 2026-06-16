/**
 * SimWorker.js — Web Worker that runs 42 simulation in a background thread.
 *
 * Message protocol:
 *
 * Main → Worker:
 *   { type: 'INIT' }                    — Load WASM and initialize simulation
 *   { type: 'REINIT' }                  — Re-initialize sim in-place (no reload)
 *   { type: 'RUN',  stepsPerBatch: N }  — Run N steps per batch, post state
 *   { type: 'PAUSE' }                   — Pause simulation
 *   { type: 'STEP' }                    — Single step
 *   { type: 'GET_FILES', paths: [...] } — Read files from MEMFS
 *   { type: 'LIST_DIR', path: '...' }  — List files in a MEMFS directory
 *   { type: 'WRITE_FILE', path, content } — Write content to MEMFS file
 *
 * Worker → Main:
 *   { type: 'STATUS', status: '...' }   — 'loading'|'ready'|'running'|'paused'|'done'|'error'
 *   { type: 'STATE',  state: {...} }    — Simulation state snapshot
 *   { type: 'FILES',  files: {...} }    — Requested file contents
 *   { type: 'DIR_LIST', path, entries } — Directory listing
 *   { type: 'FILE_WRITTEN', path, success, error? } — File write result
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
   const f64 = new Float64Array(mod.HEAPF64.buffer, ptr, 31);
   const stop = mod._sim_get_stoptime();
   const rawTime = f64[0];
   return {
      simTime: (rawTime > stop) ? stop : rawTime,
      posN:    [f64[1], f64[2], f64[3]],
      velN:    [f64[4], f64[5], f64[6]],
      qbn:     [f64[7], f64[8], f64[9], f64[10]],
      svn:     [f64[11], f64[12], f64[13]],
      nlink:   f64[14],
      done:    f64[15] > 0.5,
      wn:      [f64[16], f64[17], f64[18]],
      svb:     [f64[19], f64[20], f64[21]],
      posR:    [f64[22], f64[23], f64[24]],
      velR:    [f64[25], f64[26], f64[27]],
      hvb:     [f64[28], f64[29], f64[30]],
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

      case 'REINIT':
         if (!mod) return;
         try {
            running = false;
            mod._sim_init();
            postStatus('ready');
         } catch (err) {
            self.postMessage({ type: 'STDERR', text: 'Reinit failed: ' + err.message });
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

      case 'SET_SPEED':
         stepsPerBatch = msg.stepsPerBatch || 100;
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

      case 'WRITE_FILE':
         if (mod) {
            try {
               mod.FS.writeFile(msg.path, msg.content);
               self.postMessage({ type: 'FILE_WRITTEN', path: msg.path, success: true });
            } catch (err) {
               self.postMessage({ type: 'FILE_WRITTEN', path: msg.path, success: false, error: err.message });
            }
         }
         break;

      case 'LIST_SAMPLES':
         if (mod) listSamples();
         break;

      case 'LOAD_SAMPLE':
         if (mod) loadSample(msg.name);
         break;
   }
};

/* ------------------------------------------------------------------ */
/* Sample scenario management (WASM mode)                              */
/* ------------------------------------------------------------------ */

function listSamples() {
   try {
      const dirs = mod.FS.readdir('/samples').filter(n => n !== '.' && n !== '..');
      const samples = [];
      for (const name of dirs) {
         try {
            mod.FS.stat(`/samples/${name}/Inp_Sim.txt`);
            samples.push({ name });
         } catch (e) { /* skip dirs without Inp_Sim.txt */ }
      }
      samples.sort((a, b) => a.name.localeCompare(b.name));
      self.postMessage({ type: 'SAMPLES_LIST', samples });
   } catch (e) {
      self.postMessage({ type: 'SAMPLES_LIST', samples: [], error: e.message });
   }
}

function loadSample(name) {
   try {
      running = false;
      const samplePath = `/samples/${name}`;

      /* Verify sample exists */
      mod.FS.stat(`${samplePath}/Inp_Sim.txt`);

      /* Clear /InOut/ of existing files (keep directory) */
      const oldFiles = mod.FS.readdir('/InOut').filter(n => n !== '.' && n !== '..');
      for (const f of oldFiles) {
         try {
            const stat = mod.FS.stat(`/InOut/${f}`);
            if (mod.FS.isFile(stat.mode)) mod.FS.unlink(`/InOut/${f}`);
         } catch (e) { /* skip */ }
      }

      /* Copy all files from sample into /InOut/ */
      const entries = mod.FS.readdir(samplePath).filter(n => n !== '.' && n !== '..');
      for (const f of entries) {
         try {
            const stat = mod.FS.stat(`${samplePath}/${f}`);
            if (mod.FS.isFile(stat.mode)) {
               const data = mod.FS.readFile(`${samplePath}/${f}`);
               mod.FS.writeFile(`/InOut/${f}`, data);
            }
         } catch (e) { /* skip */ }
      }

      /* Re-initialize simulation with new config */
      mod._sim_init();

      self.postMessage({ type: 'SAMPLE_LOADED', name, success: true });
      postStatus('ready');
   } catch (e) {
      self.postMessage({ type: 'SAMPLE_LOADED', name, success: false, error: e.message });
      postStatus('error');
   }
}
