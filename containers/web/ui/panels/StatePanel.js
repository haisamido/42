/**
 * StatePanel — Live telemetry readout for 42 simulation state.
 *
 * Displays SimTime, position, velocity, attitude quaternion, and
 * simulation progress. Updates from Worker state messages.
 */

export class StatePanel {
   /**
    * @param {HTMLElement} containerEl - DOM element to render state into
    */
   constructor(containerEl) {
      this.container = containerEl;
      this._render();
   }

   _render() {
      this.container.innerHTML = `
         <div class="state-panel">
            <h3>Simulation State</h3>
            <table class="state-table">
               <tr><td>SimTime</td><td id="st-time">0.000</td><td>sec</td></tr>
               <tr><td>Progress</td><td id="st-progress">0.0</td><td>%</td></tr>
               <tr class="section-header"><td colspan="3">Position (N-frame, km)</td></tr>
               <tr><td>X</td><td id="st-px">0.000</td><td>km</td></tr>
               <tr><td>Y</td><td id="st-py">0.000</td><td>km</td></tr>
               <tr><td>Z</td><td id="st-pz">0.000</td><td>km</td></tr>
               <tr><td>|R|</td><td id="st-rmag">0.000</td><td>km</td></tr>
               <tr class="section-header"><td colspan="3">Velocity (N-frame, km/s)</td></tr>
               <tr><td>Vx</td><td id="st-vx">0.000</td><td>km/s</td></tr>
               <tr><td>Vy</td><td id="st-vy">0.000</td><td>km/s</td></tr>
               <tr><td>Vz</td><td id="st-vz">0.000</td><td>km/s</td></tr>
               <tr><td>|V|</td><td id="st-vmag">0.000</td><td>km/s</td></tr>
               <tr class="section-header"><td colspan="3">Quaternion (body in N)</td></tr>
               <tr><td>q0</td><td id="st-q0">0.000</td><td></td></tr>
               <tr><td>q1</td><td id="st-q1">0.000</td><td></td></tr>
               <tr><td>q2</td><td id="st-q2">0.000</td><td></td></tr>
               <tr><td>q3</td><td id="st-q3">0.000</td><td></td></tr>
            </table>
         </div>
      `;
   }

   /**
    * Update displayed state from a SimStateSnapshot.
    * @param {object} state - { simTime, posN, velN, qbn, done }
    * @param {number} stopTime - Simulation stop time for progress calc
    */
   update(state, stopTime) {
      if (!state) return;

      const fmt = (v, d = 3) => v.toFixed(d);

      /* Time and progress */
      this._set('st-time', fmt(state.simTime, 2));
      const pct = stopTime > 0 ? (state.simTime / stopTime) * 100 : 0;
      this._set('st-progress', fmt(Math.min(pct, 100), 1));

      /* Position (m → km) */
      const px = state.posN[0] / 1000;
      const py = state.posN[1] / 1000;
      const pz = state.posN[2] / 1000;
      const rmag = Math.sqrt(px * px + py * py + pz * pz);
      this._set('st-px', fmt(px));
      this._set('st-py', fmt(py));
      this._set('st-pz', fmt(pz));
      this._set('st-rmag', fmt(rmag));

      /* Velocity (m/s → km/s) */
      const vx = state.velN[0] / 1000;
      const vy = state.velN[1] / 1000;
      const vz = state.velN[2] / 1000;
      const vmag = Math.sqrt(vx * vx + vy * vy + vz * vz);
      this._set('st-vx', fmt(vx));
      this._set('st-vy', fmt(vy));
      this._set('st-vz', fmt(vz));
      this._set('st-vmag', fmt(vmag));

      /* Quaternion */
      this._set('st-q0', fmt(state.qbn[0], 6));
      this._set('st-q1', fmt(state.qbn[1], 6));
      this._set('st-q2', fmt(state.qbn[2], 6));
      this._set('st-q3', fmt(state.qbn[3], 6));
   }

   _set(id, value) {
      const el = this.container.querySelector('#' + id);
      if (el) el.textContent = value;
   }
}
