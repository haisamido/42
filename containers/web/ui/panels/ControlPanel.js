/**
 * ControlPanel — Play/Pause/Step controls and speed slider for 42 simulation.
 *
 * Manages the Web Worker lifecycle: sends RUN/PAUSE/STEP messages and
 * adjusts stepsPerBatch for speed control.
 */

export class ControlPanel {
   /**
    * @param {HTMLElement} containerEl - DOM element to render controls into
    * @param {Worker} worker - SimWorker instance
    */
   constructor(containerEl, worker) {
      this.container = containerEl;
      this.worker = worker;
      this.status = 'loading';
      this._stepsPerBatch = 100;
      this.onReset = null; /* Callback set by main.js */

      this._render();
   }

   _render() {
      this.container.innerHTML = `
         <div class="control-panel">
            <div class="control-buttons">
               <button id="btn-init" title="Initialize">Init</button>
               <button id="btn-play" title="Run simulation" disabled>Play</button>
               <button id="btn-pause" title="Pause simulation" disabled>Pause</button>
               <button id="btn-step" title="Single step" disabled>Step</button>
               <button id="btn-reset" title="Reset simulation" disabled>Reset</button>
            </div>
            <div class="control-speed">
               <label for="speed-slider">Speed:</label>
               <input type="range" id="speed-slider" min="1" max="1000" value="100" step="1">
               <span id="speed-value">100</span> steps/batch
            </div>
            <div class="control-status">
               Status: <span id="sim-status">loading</span>
            </div>
         </div>
      `;

      /* Wire up buttons */
      this.btnInit  = this.container.querySelector('#btn-init');
      this.btnPlay  = this.container.querySelector('#btn-play');
      this.btnPause = this.container.querySelector('#btn-pause');
      this.btnStep  = this.container.querySelector('#btn-step');
      this.btnReset = this.container.querySelector('#btn-reset');
      this.speedSlider = this.container.querySelector('#speed-slider');
      this.speedValue  = this.container.querySelector('#speed-value');
      this.statusEl    = this.container.querySelector('#sim-status');

      this.btnInit.addEventListener('click', () => {
         this.worker.postMessage({ type: 'INIT' });
         this.btnInit.disabled = true;
      });

      this.btnPlay.addEventListener('click', () => {
         this.worker.postMessage({
            type: 'RUN',
            stepsPerBatch: this._stepsPerBatch,
         });
      });

      this.btnPause.addEventListener('click', () => {
         this.worker.postMessage({ type: 'PAUSE' });
      });

      this.btnStep.addEventListener('click', () => {
         this.worker.postMessage({ type: 'STEP' });
      });

      this.btnReset.addEventListener('click', () => {
         if (this.onReset) this.onReset();
      });

      this.speedSlider.addEventListener('input', () => {
         this._stepsPerBatch = parseInt(this.speedSlider.value, 10);
         this.speedValue.textContent = this._stepsPerBatch;
      });
   }

   /**
    * Update button enabled states based on simulation status.
    * @param {string} status - 'loading'|'ready'|'running'|'paused'|'done'|'error'
    */
   /** Replace the Worker reference (used after reset) */
   setWorker(worker) {
      this.worker = worker;
   }

   setStatus(status) {
      this.status = status;
      this.statusEl.textContent = status;

      const isReady   = status === 'ready' || status === 'paused';
      const isRunning = status === 'running';
      const isDone    = status === 'done';

      this.btnInit.disabled  = status !== 'loading' && status !== 'error';
      this.btnPlay.disabled  = !(isReady);
      this.btnPause.disabled = !isRunning;
      this.btnStep.disabled  = !(isReady);
      this.btnReset.disabled = status === 'loading';

      if (isDone) {
         this.btnPlay.disabled = true;
         this.btnStep.disabled = true;
         this.btnPause.disabled = true;
      }
   }
}
