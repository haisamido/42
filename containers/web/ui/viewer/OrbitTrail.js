/**
 * OrbitTrail — Renders spacecraft orbit trajectory as a Three.js line.
 *
 * Uses a ring buffer to accumulate position history. Automatically
 * manages buffer size to show approximately the last N points.
 */

import * as THREE from 'three';

const DEFAULT_MAX_POINTS = 10000;

export class OrbitTrail {
   /**
    * @param {THREE.Scene} scene - Three.js scene to add trail to
    * @param {object} opts - Options
    * @param {number} opts.maxPoints - Maximum trail points (default 10000)
    * @param {number} opts.color - Trail color (default 0x00ff88)
    * @param {number} opts.lineWidth - Not used by WebGL (always 1px)
    */
   constructor(scene, opts = {}) {
      this.scene = scene;
      this.maxPoints = opts.maxPoints || DEFAULT_MAX_POINTS;
      this.color = opts.color || 0x00ff88;

      /* Pre-allocate buffer */
      this._positions = new Float32Array(this.maxPoints * 3);
      this._count = 0;
      this._head = 0;

      /* Create line geometry */
      this._geometry = new THREE.BufferGeometry();
      this._posAttr = new THREE.BufferAttribute(this._positions, 3);
      this._posAttr.setUsage(THREE.DynamicDrawUsage);
      this._geometry.setAttribute('position', this._posAttr);
      this._geometry.setDrawRange(0, 0);

      const material = new THREE.LineBasicMaterial({
         color: this.color,
         transparent: true,
         opacity: 0.8,
      });

      this.line = new THREE.Line(this._geometry, material);
      this.scene.add(this.line);
   }

   /**
    * Add a point to the trail (in Three.js coordinates, km).
    * @param {THREE.Vector3} point
    */
   addPoint(point) {
      const i = this._head * 3;
      this._positions[i]     = point.x;
      this._positions[i + 1] = point.y;
      this._positions[i + 2] = point.z;

      this._head = (this._head + 1) % this.maxPoints;
      if (this._count < this.maxPoints) this._count++;

      /* Update draw range and flag for GPU upload */
      this._geometry.setDrawRange(0, this._count);
      this._posAttr.needsUpdate = true;
   }

   /**
    * Clear all trail points.
    */
   clear() {
      this._count = 0;
      this._head = 0;
      this._geometry.setDrawRange(0, 0);
      this._posAttr.needsUpdate = true;
   }

   /**
    * Set trail color.
    * @param {number} color - Hex color (e.g. 0xff0000)
    */
   setColor(color) {
      this.color = color;
      this.line.material.color.setHex(color);
   }

   dispose() {
      this.scene.remove(this.line);
      this._geometry.dispose();
      this.line.material.dispose();
   }
}
