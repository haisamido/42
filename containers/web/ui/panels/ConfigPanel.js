/**
 * ConfigPanel — Simulation console output display.
 *
 * Shows stdout/stderr from the WASM simulation and provides
 * a scrollable log view. Future: editable Inp_Sim.txt parameters.
 */

export class ConfigPanel {
   /**
    * @param {HTMLElement} containerEl - DOM element to render into
    */
   constructor(containerEl) {
      this.container = containerEl;
      this._maxLines = 500;
      this._lines = [];
      this._render();
   }

   _render() {
      this.container.innerHTML = `
         <div class="config-panel">
            <div class="console-header">
               <h3>Console Output</h3>
               <button id="btn-clear-console" title="Clear console">Clear</button>
            </div>
            <pre id="console-log" class="console-log"></pre>
         </div>
      `;

      this.logEl = this.container.querySelector('#console-log');
      this.container.querySelector('#btn-clear-console')
         .addEventListener('click', () => this.clear());
   }

   /**
    * Append a line to the console log.
    * @param {string} text - Line of text
    * @param {string} type - 'stdout' or 'stderr'
    */
   appendLine(text, type = 'stdout') {
      this._lines.push({ text, type });

      /* Trim to max lines */
      if (this._lines.length > this._maxLines) {
         this._lines = this._lines.slice(-this._maxLines);
      }

      const span = document.createElement('span');
      span.className = 'console-' + type;
      span.textContent = text + '\n';
      this.logEl.appendChild(span);

      /* Auto-scroll to bottom */
      this.logEl.scrollTop = this.logEl.scrollHeight;
   }

   clear() {
      this._lines = [];
      this.logEl.innerHTML = '';
   }
}
