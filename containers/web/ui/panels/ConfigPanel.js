/**
 * ConfigPanel.js — Console output + Simulation config panel.
 *
 * Exports:
 *   ConsolePanel  — Console output log (bottom panel)
 *   SimConfigPanel — Simulation parameters (left Config tab)
 */

/**
 * ConsolePanel — Shows stdout/stderr from the WASM simulation.
 * Adapted from gmat-ui UIConsole.js.
 */
export class ConsolePanel {
   constructor(outputEl, countEl) {
      this.el = outputEl;
      this.countEl = countEl;
      this.lines = 0;
   }

   appendLine(text, type = 'stdout') {
      const span = document.createElement('span');
      if (type === 'stderr') span.className = 'err';
      else if (type === 'info') span.className = 'info';
      span.textContent = text + '\n';
      this.el.appendChild(span);
      this.el.scrollTop = this.el.scrollHeight;
      this.lines++;
      if (this.countEl) {
         this.countEl.textContent = this.lines + ' lines';
      }
   }

   clear() {
      this.el.innerHTML = '';
      this.lines = 0;
      if (this.countEl) {
         this.countEl.textContent = '0 lines';
      }
   }
}

/**
 * SimConfigPanel — Displays key simulation parameters in the Config tab.
 * Shows fields parsed from Inp_Sim.txt for quick reference.
 */
export class SimConfigPanel {
   constructor(containerEl) {
      this.container = containerEl;
      this._render();
   }

   _render() {
      this.container.innerHTML = `
         <div class="sim-config-panel">
            <div class="panel-section">
               <h3>Simulation</h3>
               <div class="form-grid">
                  <label>Status</label>
                  <input type="text" id="cfg-status" value="Not initialized" disabled>
                  <label>Sim Time</label>
                  <input type="text" id="cfg-simtime" value="0.00" disabled>
                  <label>Stop Time</label>
                  <input type="text" id="cfg-stoptime" value="--" disabled>
                  <label>DtSim</label>
                  <input type="text" id="cfg-dtsim" value="--" disabled>
               </div>
            </div>
            <div class="panel-section">
               <h3>Quick Actions</h3>
               <p style="font-size:11px;color:var(--subtext0);margin-bottom:6px">
                  Edit InOut/ files in the Files tab, then Save &amp; Run.
               </p>
            </div>
         </div>
      `;
   }

   /** Update config display from simulation state */
   updateFromState(state, stopTime) {
      if (!state) return;
      const el = (id) => this.container.querySelector('#' + id);
      const statusEl = el('cfg-status');
      const timeEl = el('cfg-simtime');
      const stopEl = el('cfg-stoptime');
      if (statusEl) statusEl.value = state.done ? 'Done' : 'Running';
      if (timeEl) timeEl.value = state.simTime.toFixed(2) + ' sec';
      if (stopEl && stopTime > 0) stopEl.value = stopTime.toFixed(0) + ' sec';
   }

   setStatus(status) {
      const el = this.container.querySelector('#cfg-status');
      if (el) el.value = status;
   }
}
