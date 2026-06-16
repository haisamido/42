/**
 * StateNormalizer.js — Ensures state objects from both backends have identical shape.
 *
 * WASM (SimWorker.js) and server (ServerBackend.js via IPC) produce state objects
 * with slightly different fields.  This normalizer fills in missing fields with
 * sensible defaults so all downstream consumers (42gl.js, StatePanel, etc.) can
 * safely access any property without checking for existence.
 *
 * Canonical state shape:
 *   {
 *     simTime:      number,      // seconds
 *     posN:         [x,y,z],     // meters, ECI
 *     velN:         [x,y,z],     // m/s, ECI
 *     qbn:          [q0,q1,q2,q3], // scalar-first body quaternion
 *     svn:          [x,y,z],     // unit sun vector, ECI
 *     svb:          [x,y,z],     // unit sun vector, body frame
 *     wn:           [x,y,z],     // angular velocity, rad/s
 *     posR:         [x,y,z],     // position wrt ref orbit, N (m)
 *     velR:         [x,y,z],     // velocity wrt ref orbit, N (m/s)
 *     hvb:          [x,y,z],     // angular momentum, body (Nms)
 *     nlink:        number,      // comm link count
 *     done:         boolean,     // simulation complete
 *     trailPoints:  [[x,y,z],...] // batch of posN trail points (may be empty)
 *   }
 */

const ZERO3 = [0, 0, 0];
const IDENTITY_Q = [1, 0, 0, 0];

/**
 * Normalize a raw state object from either backend into the canonical shape.
 * Mutates and returns the same object for zero-allocation hot path.
 *
 * @param {Object} state — raw state from WASM or IPC backend
 * @returns {Object} — the same object with all fields guaranteed present
 */
export function normalizeState(state) {
   if (!state) return null;

   state.simTime     = state.simTime     ?? 0;
   state.posN        = state.posN        ?? ZERO3;
   state.velN        = state.velN        ?? ZERO3;
   state.qbn         = state.qbn         ?? IDENTITY_Q;
   state.svn         = state.svn         ?? ZERO3;
   state.svb         = state.svb         ?? ZERO3;
   state.wn          = state.wn          ?? ZERO3;
   state.posR        = state.posR        ?? ZERO3;
   state.velR        = state.velR        ?? ZERO3;
   state.hvb         = state.hvb         ?? ZERO3;
   state.nlink       = state.nlink       ?? 0;
   state.done        = state.done        ?? false;
   state.trailPoints = state.trailPoints ?? [];

   return state;
}
