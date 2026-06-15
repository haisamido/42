/**
 * SceneManager — Three.js scene setup for 42 orbit visualization.
 *
 * Creates Earth sphere with day/night shader, atmosphere, starfield,
 * camera with orbit controls. Coordinate transform: 42 N-frame (Z-up ECI)
 * to Three.js (Y-up).
 *
 * 42 N-frame:  X = vernal equinox, Y = 90deg in equatorial plane, Z = north pole
 * Three.js:    X = right, Y = up, Z = toward camera
 * Transform:   Three.x = N.x,  Three.y = N.z,  Three.z = -N.y
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EARTH_RADIUS_KM = 6371.0;

export class SceneManager {
   constructor(containerEl) {
      this.container = containerEl;
      this.scene = null;
      this.camera = null;
      this.renderer = null;
      this.controls = null;
      this.earth = null;
      this.atmosphere = null;
      this.sunDirection = new THREE.Vector3(1, 0, 0);
      this._animationId = null;
      this._isAnimating = false;
   }

   init(earthVertexShader, earthFragmentShader, atmosVertexShader, atmosFragmentShader) {
      /* Scene */
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x000000);

      /* Renderer */
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.container.appendChild(this.renderer.domElement);

      /* Camera */
      const aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera = new THREE.PerspectiveCamera(45, aspect, 10, 500000);
      this.camera.position.set(0, 5000, 20000);

      /* Controls */
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = EARTH_RADIUS_KM * 1.2;
      this.controls.maxDistance = EARTH_RADIUS_KM * 50;
      this.controls.enablePan = false;

      /* Earth */
      this._createEarth(earthVertexShader, earthFragmentShader);

      /* Atmosphere */
      this._createAtmosphere(atmosVertexShader, atmosFragmentShader);

      /* Starfield */
      this._createStarfield();

      /* Ambient light (for non-shader objects) */
      this.scene.add(new THREE.AmbientLight(0x404040));

      /* Handle resize */
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this.container);
      this._onResize();

      /* Start render loop */
      this._isAnimating = true;
      this._animate();
   }

   _createEarth(vertShader, fragShader) {
      const geometry = new THREE.SphereGeometry(EARTH_RADIUS_KM, 64, 64);

      if (vertShader && fragShader) {
         /* Custom day/night shader */
         const textureLoader = new THREE.TextureLoader();
         const dayTex = textureLoader.load(
            'https://unpkg.com/three@0.172.0/examples/textures/planets/earth_atmos_2048.jpg'
         );
         dayTex.colorSpace = THREE.SRGBColorSpace;

         const material = new THREE.ShaderMaterial({
            vertexShader: vertShader,
            fragmentShader: fragShader,
            uniforms: {
               uDayTexture:   { value: dayTex },
               uSunDirection: { value: this.sunDirection },
            },
         });
         this.earth = new THREE.Mesh(geometry, material);
      } else {
         /* Fallback: basic textured sphere */
         const material = new THREE.MeshPhongMaterial({ color: 0x2244aa });
         this.earth = new THREE.Mesh(geometry, material);
      }

      this.scene.add(this.earth);
   }

   _createAtmosphere(vertShader, fragShader) {
      const geometry = new THREE.SphereGeometry(EARTH_RADIUS_KM * 1.02, 64, 64);

      if (vertShader && fragShader) {
         const material = new THREE.ShaderMaterial({
            vertexShader: vertShader,
            fragmentShader: fragShader,
            uniforms: {
               uSunDirection: { value: this.sunDirection },
            },
            transparent: true,
            side: THREE.BackSide,
            depthWrite: false,
         });
         this.atmosphere = new THREE.Mesh(geometry, material);
      } else {
         const material = new THREE.MeshBasicMaterial({
            color: 0x88aaff,
            transparent: true,
            opacity: 0.1,
            side: THREE.BackSide,
         });
         this.atmosphere = new THREE.Mesh(geometry, material);
      }

      this.scene.add(this.atmosphere);
   }

   _createStarfield() {
      const count = 3000;
      const positions = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
         const theta = Math.random() * Math.PI * 2;
         const phi = Math.acos(2 * Math.random() - 1);
         const r = EARTH_RADIUS_KM * (30 + Math.random() * 20);
         positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
         positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
         positions[i * 3 + 2] = r * Math.cos(phi);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const material = new THREE.PointsMaterial({
         color: 0xffffff,
         size: 20,
         sizeAttenuation: true,
      });

      this.scene.add(new THREE.Points(geometry, material));
   }

   /**
    * Convert 42 N-frame position (meters) to Three.js coordinates (km).
    * N-frame: X=vernal equinox, Y=90deg equatorial, Z=north pole
    * Three.js: Y-up
    */
   nFrameToThreeJS(posN) {
      return new THREE.Vector3(
         posN[0] / 1000.0,     /* X stays X */
         posN[2] / 1000.0,     /* Z becomes Y (up) */
         -posN[1] / 1000.0     /* -Y becomes Z */
      );
   }

   /**
    * Update sun direction from 42's sun vector in N-frame.
    */
   updateSunDirection(svn) {
      this.sunDirection.set(svn[0], svn[2], -svn[1]).normalize();

      if (this.earth && this.earth.material.uniforms) {
         this.earth.material.uniforms.uSunDirection.value.copy(this.sunDirection);
      }
      if (this.atmosphere && this.atmosphere.material.uniforms) {
         this.atmosphere.material.uniforms.uSunDirection.value.copy(this.sunDirection);
      }
   }

   _onResize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w === 0 || h === 0) return;

      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
   }

   _animate() {
      if (!this._isAnimating) return;
      this._animationId = requestAnimationFrame(() => this._animate());

      this.controls.update();
      this.renderer.render(this.scene, this.camera);
   }

   dispose() {
      this._isAnimating = false;
      if (this._animationId) cancelAnimationFrame(this._animationId);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      if (this.renderer) {
         this.renderer.dispose();
         this.renderer.domElement.remove();
      }
   }
}
