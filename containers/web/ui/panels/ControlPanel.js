/**
 * ControlPanel — Toolbar controller for 42 simulation.
 *
 * Binds to toolbar buttons in the header (Init, Run, Pause, Step, Reset)
 * and the speed slider. No longer renders its own DOM.
 */

export class ControlPanel {
   /**
    * @param {Worker} worker - SimWorker instance (or null, set later)
    */
   constructor(worker) {
      this.worker = worker;
      this.status = 'loading';
      this._stepsPerBatch = 100;
      this.onReset = null;
      this.onRun = null;
      this.serverMode = (window.__42_MODE === 'server');

      this._bind();
   }

   _bind() {
      this.btnInit  = document.getElementById('btn-init');
      this.btnRun   = document.getElementById('btn-run');
      this.btnPause = document.getElementById('btn-pause');
      this.btnStep  = document.getElementById('btn-step');
      this.btnReset = document.getElementById('btn-reset');
      this.speedSlider = document.getElementById('speed-slider');
      this.speedValue  = document.getElementById('speed-value');
      this.statusEl    = document.getElementById('status-indicator');

      this.btnInit?.addEventListener('click', () => {
         this.worker.postMessage({ type: 'INIT' });
         this.btnInit.disabled = true;
      });

      this.btnRun?.addEventListener('click', () => {
         if (this.onRun) {
            this.onRun();
         } else {
            this.worker.postMessage({
               type: 'RUN',
               stepsPerBatch: this._stepsPerBatch,
            });
         }
      });

      this.btnPause?.addEventListener('click', () => {
         this.worker.postMessage({ type: 'PAUSE' });
      });

      this.btnStep?.addEventListener('click', () => {
         this.worker.postMessage({ type: 'STEP' });
      });

      this.btnReset?.addEventListener('click', () => {
         if (this.onReset) this.onReset();
      });

      this.speedSlider?.addEventListener('input', () => {
         this._stepsPerBatch = parseInt(this.speedSlider.value, 10);
         this.speedValue.textContent = this._stepsPerBatch;
      });
   }

   setWorker(worker) {
      this.worker = worker;
   }

   /**
    * Update button enabled states based on simulation status.
    * @param {string} status - 'loading'|'ready'|'running'|'paused'|'done'|'error'
    */
   setStatus(status) {
      this.status = status;

      const statusLabels = {
         loading: 'Loading...',
         ready: 'Ready',
         running: 'Running',
         paused: 'Paused',
         done: 'Done',
         error: 'Error',
      };
      this.statusEl.textContent = statusLabels[status] || status;
      this.statusEl.className = status;

      const isReady   = status === 'ready' || status === 'paused';
      const isRunning = status === 'running';
      const isDone    = status === 'done';

      this.btnInit.disabled  = status !== 'loading' && status !== 'error';
      this.btnRun.disabled   = !isReady;
      this.btnPause.disabled = !isRunning;
      this.btnStep.disabled  = !isReady;
      this.btnReset.disabled = status === 'loading';

      if (isDone) {
         this.btnRun.disabled = false;
         this.btnStep.disabled = true;
         this.btnPause.disabled = true;
      }
   }
}
