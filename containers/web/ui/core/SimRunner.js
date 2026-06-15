/**
 * SimRunner — WASM module lifecycle manager for 42 simulation.
 *
 * Handles loading the Emscripten module, calling sim_init/sim_step/sim_get_state,
 * and reading output files from the virtual filesystem.
 *
 * Usage:
 *   const runner = new SimRunner({ onStdout, onStderr, onStatus });
 *   await runner.init();
 *   runner.step();           // advance one timestep
 *   const s = runner.getState(); // { simTime, posN, velN, qbn, svn, done }
 */

export class SimRunner {
   constructor(opts = {}) {
      this.onStdout = opts.onStdout || (() => {});
      this.onStderr = opts.onStderr || (() => {});
      this.onStatus = opts.onStatus || (() => {});
      this.module = null;
      this.ready = false;
   }

   async init() {
      this.onStatus('loading');

      if (typeof window.create42Module !== 'function') {
         throw new Error('create42Module not found — ensure 42.js is loaded');
      }

      this.module = await window.create42Module({
         print:   (text) => this.onStdout(text),
         printErr: (text) => this.onStderr(text),
         locateFile: (path) => '../' + path,
      });

      /* Verify virtual filesystem has InOut */
      try {
         this.module.FS.stat('/InOut/Inp_Sim.txt');
      } catch (e) {
         throw new Error('MEMFS missing /InOut/Inp_Sim.txt — preload-file failed');
      }

      /* Initialize simulation */
      this.module._sim_init();
      this.ready = true;
      this.onStatus('ready');
   }

   /**
    * Advance simulation by one timestep.
    * @returns {number} 1 if simulation complete, 0 otherwise
    */
   step() {
      if (!this.ready) throw new Error('SimRunner not initialized');
      return this.module._sim_step();
   }

   /**
    * Read current simulation state from WASM heap.
    * Returns a plain object with typed fields.
    */
   getState() {
      if (!this.ready) return null;

      const ptr = this.module._sim_get_state();
      /* SimStateSnapshot is 16 doubles (128 bytes) starting at ptr */
      const byteOffset = ptr;
      const f64 = new Float64Array(this.module.HEAPF64.buffer, byteOffset, 16);

      return {
         simTime: f64[0],
         posN:    [f64[1], f64[2], f64[3]],       /* meters, N frame */
         velN:    [f64[4], f64[5], f64[6]],       /* m/s, N frame */
         qbn:     [f64[7], f64[8], f64[9], f64[10]], /* quaternion */
         svn:     [f64[11], f64[12], f64[13]],    /* sun vector, N frame */
         nlink:   f64[14],
         done:    f64[15] > 0.5,
      };
   }

   /** Get current simulation time (seconds). */
   getTime() {
      if (!this.ready) return 0;
      return this.module._sim_get_time();
   }

   /** Get simulation stop time (seconds). */
   getStopTime() {
      if (!this.ready) return 0;
      return this.module._sim_get_stoptime();
   }

   /** Get simulation timestep (seconds). */
   getDtSim() {
      if (!this.ready) return 0;
      return this.module._sim_get_dtsim();
   }

   /**
    * Read a file from the virtual filesystem (MEMFS).
    * @param {string} path - Absolute path, e.g. '/InOut/Link0.csv'
    * @returns {string} File contents as UTF-8 text
    */
   getOutputFile(path) {
      if (!this.ready) return '';
      try {
         return this.module.FS.readFile(path, { encoding: 'utf8' });
      } catch (e) {
         return '';
      }
   }

   /**
    * List files in a MEMFS directory.
    * @param {string} dirPath - Directory path, e.g. '/InOut'
    * @returns {string[]} Array of filenames
    */
   listDir(dirPath) {
      if (!this.ready) return [];
      try {
         return this.module.FS.readdir(dirPath).filter(f => f !== '.' && f !== '..');
      } catch (e) {
         return [];
      }
   }
}
