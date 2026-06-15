/**
 * SpacecraftView — Renders a spacecraft marker with body-frame axes.
 *
 * Displays the SC as a small sphere with RGB axes (X=red, Y=green, Z=blue)
 * showing the body-frame orientation via quaternion.
 *
 * Quaternion convention (42):
 *   qn[4] = [q0, q1, q2, q3] where q0 is scalar
 *   Represents rotation from N-frame to Body-frame
 */

import * as THREE from 'three';

const SC_MARKER_SIZE = 80; /* km — visual size of SC marker */
const AXIS_LENGTH = 200;   /* km — length of body-frame axes */

export class SpacecraftView {
   /**
    * @param {THREE.Scene} scene
    * @param {Function} nFrameToThreeJS - Coordinate transform function
    */
   constructor(scene, nFrameToThreeJS) {
      this.scene = scene;
      this.nFrameToThreeJS = nFrameToThreeJS;

      /* SC marker: small sphere */
      const geometry = new THREE.SphereGeometry(SC_MARKER_SIZE, 16, 16);
      const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
      this.marker = new THREE.Mesh(geometry, material);

      /* Body-frame axes */
      this.axesGroup = new THREE.Group();
      this._addAxis(0xff0000, [1, 0, 0]); /* X = red */
      this._addAxis(0x00ff00, [0, 1, 0]); /* Y = green */
      this._addAxis(0x0044ff, [0, 0, 1]); /* Z = blue */

      this.group = new THREE.Group();
      this.group.add(this.marker);
      this.group.add(this.axesGroup);
      this.scene.add(this.group);
   }

   _addAxis(color, dir) {
      const points = [
         new THREE.Vector3(0, 0, 0),
         new THREE.Vector3(
            dir[0] * AXIS_LENGTH,
            dir[1] * AXIS_LENGTH,
            dir[2] * AXIS_LENGTH
         ),
      ];
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color });
      this.axesGroup.add(new THREE.Line(geometry, material));
   }

   /**
    * Update spacecraft position and orientation.
    * @param {number[]} posN - Position in N-frame [x, y, z] meters
    * @param {number[]} qbn - Quaternion [q0, q1, q2, q3] (scalar-first)
    */
   update(posN, qbn) {
      /* Position: convert from N-frame meters to Three.js km */
      const pos = this.nFrameToThreeJS(posN);
      this.group.position.copy(pos);

      /* Orientation: 42 uses scalar-first [q0, q1, q2, q3]
         Three.js Quaternion constructor is (x, y, z, w) */
      if (qbn && qbn.length === 4) {
         /* Convert N-frame quaternion to Three.js Y-up frame:
            Same transform as position: swap Y↔Z and negate new Z */
         const q42 = new THREE.Quaternion(qbn[1], qbn[3], -qbn[2], qbn[0]);
         this.axesGroup.setRotationFromQuaternion(q42);
      }
   }

   setVisible(visible) {
      this.group.visible = visible;
   }

   dispose() {
      this.scene.remove(this.group);
      this.marker.geometry.dispose();
      this.marker.material.dispose();
      this.axesGroup.children.forEach(child => {
         child.geometry.dispose();
         child.material.dispose();
      });
   }
}
