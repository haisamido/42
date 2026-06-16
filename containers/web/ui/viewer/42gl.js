/**
 * 42gl.js — Three.js rendering engine for the 42 spacecraft simulation.
 *
 * Port of 42gl.c / 42glfw.c OpenGL rendering to WebGL via Three.js.
 * Provides:
 *   - CamView:  3D orbital view (Earth, spacecraft OBJ model, orbit trail, starfield)
 *   - MapView:  2D Mercator ground track projection with day/night terminator
 *   - HUD:      HTML overlay (clock, camera mode, frame info)
 *   - Camera modes: FREE, TRACK_SC, TRACK_SC_BODY
 *   - PPM texture loading from World/ directory
 *   - OBJ+MTL model loading from Model/ directory
 *
 * Coordinate convention:
 *   42 N-frame:  X = vernal equinox, Y = 90° equatorial, Z = north pole
 *   Three.js:    X = right, Y = up, Z = toward camera
 *   Transform:   Three.x = N.x,  Three.y = N.z,  Three.z = -N.y
 *
 * Usage:
 *   import { FortyTwoGL } from './viewer/42gl.js';
 *
 *   const gl42 = new FortyTwoGL({ textureBase: '/api/files/raw/World' });
 *   const cam  = gl42.createCamView(containerEl);
 *   const map  = gl42.createMapView(mapContainerEl);
 *   // In state handler:
 *   gl42.update(state);
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { loadPpmTexture, loadPpmImageData } from './PpmLoader.js';

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const EARTH_RADIUS_KM = 6371.0;
const EARTH_ROT_RATE  = 7.2921159e-5; /* rad/s */
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Camera modes (cf. 42's POV.Mode: TRACK_HOST, TRACK_TARGET, FIXED_IN_HOST) */
export const CAM_MODE = {
   FREE:          0, /* OrbitControls — user-controlled */
   TRACK_SC:      1, /* Camera follows SC, Earth at center */
   TRACK_SC_BODY: 2, /* Camera rides on SC, body-frame boresight */
};

/* ================================================================== */
/* GLSL Shader Sources                                                 */
/* ================================================================== */

/** Earth day/night shader — samples day texture, blends to dark on night side. */
const EARTH_VS = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
   vUv = uv;
   vNormal = normalize(normalMatrix * normal);
   vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const EARTH_FS = `
uniform sampler2D uDayTexture;
uniform vec3 uSunDirection;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
   vec3 normal = normalize(vNormal);
   float sunDot = dot(normal, normalize(uSunDirection));
   float dayFactor = smoothstep(-0.1, 0.2, sunDot);

   vec4 dayColor = texture2D(uDayTexture, vUv);
   vec3 nightColor = vec3(0.02, 0.02, 0.05);

   vec3 color = mix(nightColor, dayColor.rgb, dayFactor);
   gl_FragColor = vec4(color, 1.0);
}
`;

/** Atmosphere rim glow (rendered on a BackSide sphere slightly larger than Earth). */
const ATMOS_VS = `
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
   vNormal = normalize(normalMatrix * normal);
   vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMOS_FS = `
uniform vec3 uSunDirection;

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
   vec3 normal = normalize(vNormal);
   vec3 viewDir = normalize(-vPosition);

   float rim = 1.0 - max(dot(viewDir, normal), 0.0);
   rim = pow(rim, 3.0);

   float sunDot = max(dot(normal, normalize(uSunDirection)), 0.0);
   float atmoIntensity = rim * (0.3 + 0.7 * sunDot);

   vec3 atmoColor = vec3(0.3, 0.6, 1.0);
   gl_FragColor = vec4(atmoColor, atmoIntensity * 0.6);
}
`;

/* ================================================================== */
/* Utility Functions                                                   */
/* ================================================================== */

/** Convert 42 N-frame position [m] to Three.js coordinates [km].
 *  N-frame Z-up → Three.js Y-up. */
function nToThree(posN) {
   return new THREE.Vector3(
      posN[0] / 1000, posN[2] / 1000, -posN[1] / 1000
   );
}

/** Convert 42 N-frame unit vector to Three.js direction. */
function nDirToThree(v) {
   return new THREE.Vector3(v[0], v[2], -v[1]);
}

/** Convert 42 quaternion [q0,q1,q2,q3] (scalar-first, N→B) to Three.js Quaternion.
 *  Applies the same axis swap as nToThree. */
function qbnToThree(qbn) {
   return new THREE.Quaternion(qbn[1], qbn[3], -qbn[2], qbn[0]);
}

/** Convert ECI position [m] to geodetic lat/lng [deg] given Earth rotation angle.
 *  @param {number[]} posN — ECI position [m]
 *  @param {number} theta — Earth rotation angle [rad] (= ωE * simTime + GMST0)
 *  @returns {{ lat: number, lng: number, alt: number }} */
function eciToLatLng(posN, theta) {
   const cosT = Math.cos(theta), sinT = Math.sin(theta);
   const xECEF =  cosT * posN[0] + sinT * posN[1];
   const yECEF = -sinT * posN[0] + cosT * posN[1];
   const zECEF =  posN[2];

   const r = Math.sqrt(xECEF * xECEF + yECEF * yECEF + zECEF * zECEF);
   return {
      lat: Math.asin(zECEF / r) * RAD2DEG,
      lng: Math.atan2(yECEF, xECEF) * RAD2DEG,
      alt: r - EARTH_RADIUS_KM * 1000,
   };
}

/** Rotate a unit vector from ECI to ECEF. */
function eciToEcef(v, theta) {
   const cosT = Math.cos(theta), sinT = Math.sin(theta);
   return [
       cosT * v[0] + sinT * v[1],
      -sinT * v[0] + cosT * v[1],
       v[2],
   ];
}

/** Format seconds as HH:MM:SS. */
function fmtHMS(seconds) {
   const h = Math.floor(seconds / 3600);
   const m = Math.floor((seconds % 3600) / 60);
   const s = Math.floor(seconds % 60);
   return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ================================================================== */
/* CamView — 3D Orbital View                                           */
/* Equivalent to CamRenderExec() → DrawFarScene() + DrawBodies()       */
/* ================================================================== */

class CamView {
   /**
    * @param {HTMLElement} containerEl — DOM element to render into
    * @param {FortyTwoGL} gl42 — parent orchestrator (for texture cache)
    * @param {object} opts — options
    * @param {string} opts.earthTexture — World/ filename (default 'BlueMarble2.ppm')
    * @param {string} opts.modelName — Model/ OBJ name (e.g. 'IonCruiser')
    * @param {string} opts.modelBasePath — base URL for Model/ files
    */
   constructor(containerEl, gl42, opts = {}) {
      this.container = containerEl;
      this.gl42 = gl42;
      this.opts = opts;

      /* State tracking */
      this._sunDirection = new THREE.Vector3(1, 0, 0);
      this._scPosition = new THREE.Vector3();
      this._scQuaternion = new THREE.Quaternion();
      this._camMode = CAM_MODE.FREE;
      this._scVisible = false;

      /* ---- Scene ---- */
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x000000);

      /* ---- Renderer ---- */
      this.renderer = new THREE.WebGLRenderer({ antialias: true });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.container.appendChild(this.renderer.domElement);

      /* ---- Camera ---- */
      const aspect = containerEl.clientWidth / Math.max(containerEl.clientHeight, 1);
      this.camera = new THREE.PerspectiveCamera(45, aspect, 10, 500000);
      this.camera.position.set(0, 5000, 20000);

      /* ---- Controls ---- */
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.minDistance = EARTH_RADIUS_KM * 1.2;
      this.controls.maxDistance = EARTH_RADIUS_KM * 50;
      this.controls.enablePan = false;

      /* ---- Build scene objects ---- */
      this._createEarth(opts.earthTexture || 'BlueMarble2.ppm');
      this._createAtmosphere();
      this._createStarfield();
      this._createSpacecraft();
      this._createTrail();

      /* Ambient light (for non-shader objects like spacecraft) */
      this.scene.add(new THREE.AmbientLight(0x404040));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
      dirLight.position.copy(this._sunDirection);
      this.scene.add(dirLight);
      this._dirLight = dirLight;

      /* ---- HUD Overlay ---- */
      this.hud = new HUDOverlay(containerEl);

      /* ---- Resize ---- */
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this.container);
      this._onResize();

      /* ---- Render loop ---- */
      this._isAnimating = true;
      this._animate();
   }

   /* ------------------------------------------------------------------ */
   /* Earth                                                               */
   /* ------------------------------------------------------------------ */

   _createEarth(textureFile) {
      const geometry = new THREE.SphereGeometry(EARTH_RADIUS_KM, 64, 64);

      /* Start with a basic blue sphere while the PPM texture loads */
      const basicMat = new THREE.MeshPhongMaterial({ color: 0x2244aa });
      this.earth = new THREE.Mesh(geometry, basicMat);
      this.scene.add(this.earth);

      /* Async: load PPM texture from World/, then upgrade to day/night shader */
      this._loadEarthTexture(textureFile);
   }

   async _loadEarthTexture(textureFile) {
      let dayTex = null;

      /* Try World/ PPM texture first */
      try {
         const basePath = this.gl42.opts.textureBase || '/api/files/raw/World';
         dayTex = await loadPpmTexture(`${basePath}/${textureFile}`);
      } catch (e) {
         /* Fallback: CDN texture */
         try {
            const loader = new THREE.TextureLoader();
            dayTex = await new Promise((resolve, reject) => {
               loader.load(
                  'https://unpkg.com/three@0.172.0/examples/textures/planets/earth_atmos_2048.jpg',
                  resolve, undefined, reject
               );
            });
            dayTex.colorSpace = THREE.SRGBColorSpace;
         } catch (e2) {
            console.warn('[42gl] Earth texture unavailable, keeping blue sphere');
            return;
         }
      }

      /* Upgrade to day/night shader material */
      const shaderMat = new THREE.ShaderMaterial({
         vertexShader: EARTH_VS,
         fragmentShader: EARTH_FS,
         uniforms: {
            uDayTexture:   { value: dayTex },
            uSunDirection: { value: this._sunDirection },
         },
      });

      this.earth.material.dispose();
      this.earth.material = shaderMat;
   }

   /* ------------------------------------------------------------------ */
   /* Atmosphere                                                          */
   /* ------------------------------------------------------------------ */

   _createAtmosphere() {
      const geometry = new THREE.SphereGeometry(EARTH_RADIUS_KM * 1.02, 64, 64);
      const material = new THREE.ShaderMaterial({
         vertexShader: ATMOS_VS,
         fragmentShader: ATMOS_FS,
         uniforms: {
            uSunDirection: { value: this._sunDirection },
         },
         transparent: true,
         side: THREE.BackSide,
         depthWrite: false,
      });
      this.atmosphere = new THREE.Mesh(geometry, material);
      this.scene.add(this.atmosphere);
   }

   /* ------------------------------------------------------------------ */
   /* Starfield                                                           */
   /* Equivalent to DrawStars() in 42gl.c                                */
   /* ------------------------------------------------------------------ */

   _createStarfield() {
      const count = 3000;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      for (let i = 0; i < count; i++) {
         const theta = Math.random() * Math.PI * 2;
         const phi = Math.acos(2 * Math.random() - 1);
         const r = EARTH_RADIUS_KM * (30 + Math.random() * 20);
         positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
         positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
         positions[i * 3 + 2] = r * Math.cos(phi);

         /* Slight color variation (warm/cool stars) */
         const temp = 0.7 + Math.random() * 0.3;
         colors[i * 3]     = temp;
         colors[i * 3 + 1] = temp;
         colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
         size: 20,
         sizeAttenuation: true,
         vertexColors: true,
      });

      this._starfield = new THREE.Points(geometry, material);
      this.scene.add(this._starfield);
   }

   /* ------------------------------------------------------------------ */
   /* Spacecraft marker + OBJ model                                      */
   /* Equivalent to DrawBodies() → OpaquePass() in 42gl.c                */
   /* ------------------------------------------------------------------ */

   _createSpacecraft() {
      const SC_MARKER_SIZE = 80; /* km */
      const AXIS_LENGTH = 200;   /* km */

      /* Marker sphere (visible until OBJ model loads) */
      this._scMarker = new THREE.Mesh(
         new THREE.SphereGeometry(SC_MARKER_SIZE, 16, 16),
         new THREE.MeshBasicMaterial({ color: 0xffff00 })
      );

      /* Body-frame axes */
      this._scAxes = new THREE.Group();
      const axisColors = [0xff0000, 0x00ff00, 0x0044ff];
      const axisVecs   = [[1,0,0], [0,1,0], [0,0,1]];
      for (let i = 0; i < 3; i++) {
         const pts = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(
               axisVecs[i][0] * AXIS_LENGTH,
               axisVecs[i][1] * AXIS_LENGTH,
               axisVecs[i][2] * AXIS_LENGTH
            ),
         ];
         const geom = new THREE.BufferGeometry().setFromPoints(pts);
         const mat  = new THREE.LineBasicMaterial({ color: axisColors[i] });
         this._scAxes.add(new THREE.Line(geom, mat));
      }

      /* Group for all SC objects */
      this._scGroup = new THREE.Group();
      this._scGroup.add(this._scMarker);
      this._scGroup.add(this._scAxes);
      this._scGroup.visible = false;
      this.scene.add(this._scGroup);

      /* Loaded OBJ model (replaces marker) */
      this._scModel = null;
   }

   /**
    * Load an OBJ model from Model/ directory.
    * @param {string} modelName — base name (e.g. 'IonCruiser', 'HST')
    * @param {string} basePath — URL prefix for Model/ files
    */
   async loadModel(modelName, basePath) {
      basePath = basePath || this.gl42.opts.modelBase || '/api/files/raw/Model';

      try {
         /* Try with MTL materials (colors will work, PPM textures may fail) */
         const mtlLoader = new MTLLoader();
         mtlLoader.setPath(basePath + '/');

         let materials = null;
         try {
            materials = await new Promise((resolve, reject) => {
               mtlLoader.load(modelName + '.mtl', resolve, undefined, reject);
            });
            materials.preload();
         } catch (e) {
            /* MTL not found — proceed without materials */
         }

         const objLoader = new OBJLoader();
         if (materials) objLoader.setMaterials(materials);

         const obj = await new Promise((resolve, reject) => {
            objLoader.load(
               `${basePath}/${modelName}.obj`,
               resolve, undefined, reject
            );
         });

         /* If no MTL was loaded, apply a default gray material */
         if (!materials) {
            obj.traverse(child => {
               if (child.isMesh) {
                  child.material = new THREE.MeshPhongMaterial({
                     color: 0x888888,
                     shininess: 30,
                  });
               }
            });
         }

         /* Scale and center the model.
            42's OBJ models are in meters; Three.js scene is in km. */
         const box = new THREE.Box3().setFromObject(obj);
         const size = box.getSize(new THREE.Vector3());
         const maxDim = Math.max(size.x, size.y, size.z);

         /* Scale to ~200 km visual size for visibility */
         const scaleKm = 200 / maxDim;
         obj.scale.set(scaleKm, scaleKm, scaleKm);

         /* Center the model at origin of SC group */
         const center = box.getCenter(new THREE.Vector3());
         obj.position.sub(center.multiplyScalar(scaleKm));

         /* Replace marker with loaded model */
         if (this._scModel) {
            this._scGroup.remove(this._scModel);
            this._scModel.traverse(child => {
               if (child.geometry) child.geometry.dispose();
               if (child.material) {
                  if (Array.isArray(child.material)) {
                     child.material.forEach(m => m.dispose());
                  } else {
                     child.material.dispose();
                  }
               }
            });
         }
         this._scMarker.visible = false;
         this._scModel = obj;
         this._scGroup.add(obj);

         console.log(`[42gl] Loaded model: ${modelName} (${maxDim.toFixed(0)}m)`);
      } catch (e) {
         console.warn(`[42gl] Failed to load model '${modelName}':`, e.message);
         this._scMarker.visible = true;
      }
   }

   /* ------------------------------------------------------------------ */
   /* Orbit trail (ring buffer)                                           */
   /* ------------------------------------------------------------------ */

   _createTrail() {
      const MAX_POINTS = 10000;
      this._trailPositions = new Float32Array(MAX_POINTS * 3);
      this._trailCount = 0;
      this._trailHead = 0;
      this._trailMax = MAX_POINTS;

      const geometry = new THREE.BufferGeometry();
      this._trailAttr = new THREE.BufferAttribute(this._trailPositions, 3);
      this._trailAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('position', this._trailAttr);
      geometry.setDrawRange(0, 0);

      const material = new THREE.LineBasicMaterial({
         color: 0x00ff88,
         transparent: true,
         opacity: 0.8,
      });

      this._trail = new THREE.Line(geometry, material);
      this.scene.add(this._trail);
   }

   _addTrailPoint(threePos) {
      const i = this._trailHead * 3;
      this._trailPositions[i]     = threePos.x;
      this._trailPositions[i + 1] = threePos.y;
      this._trailPositions[i + 2] = threePos.z;

      this._trailHead = (this._trailHead + 1) % this._trailMax;
      if (this._trailCount < this._trailMax) this._trailCount++;

      this._trail.geometry.setDrawRange(0, this._trailCount);
      this._trailAttr.needsUpdate = true;
   }

   clearTrail() {
      this._trailCount = 0;
      this._trailHead = 0;
      this._trail.geometry.setDrawRange(0, 0);
      this._trailAttr.needsUpdate = true;
   }

   /* ------------------------------------------------------------------ */
   /* Camera modes                                                        */
   /* Equivalent to SetPovOrientation() + PovTrackHostMode() in 42gl.c   */
   /* ------------------------------------------------------------------ */

   setCameraMode(mode) {
      this._camMode = mode;
      if (mode === CAM_MODE.FREE) {
         this.controls.enabled = true;
         this.controls.target.set(0, 0, 0);
      } else {
         this.controls.enabled = (mode === CAM_MODE.TRACK_SC);
      }
      this.hud.setCamMode(mode);
   }

   _updateCamera(state) {
      if (this._camMode === CAM_MODE.TRACK_SC && this._scVisible) {
         /* Camera target follows SC, user can orbit around it */
         this.controls.target.copy(this._scPosition);
      }
      else if (this._camMode === CAM_MODE.TRACK_SC_BODY && this._scVisible) {
         /* Camera rides on SC, looking along +X body axis */
         const offset = new THREE.Vector3(0, 200, -500);
         offset.applyQuaternion(this._scQuaternion);
         this.camera.position.copy(this._scPosition).add(offset);
         this.camera.quaternion.copy(this._scQuaternion);
         this.controls.enabled = false;
      }
   }

   /* ------------------------------------------------------------------ */
   /* State update                                                        */
   /* ------------------------------------------------------------------ */

   update(state) {
      if (!state) return;

      /* Orbit trail — handle both batch (trailPoints) and single point */
      if (state.trailPoints && state.trailPoints.length > 0) {
         for (const p of state.trailPoints) {
            this._addTrailPoint(nToThree(p));
         }
      } else if (state.posN && (state.posN[0] || state.posN[1] || state.posN[2])) {
         this._addTrailPoint(nToThree(state.posN));
      }

      /* Spacecraft position + orientation */
      if (state.posN) {
         this._scPosition.copy(nToThree(state.posN));
         this._scGroup.position.copy(this._scPosition);

         if (!this._scVisible && (state.posN[0] || state.posN[1] || state.posN[2])) {
            this._scGroup.visible = true;
            this._scVisible = true;
         }
      }

      if (state.qbn && state.qbn.length === 4) {
         this._scQuaternion.copy(qbnToThree(state.qbn));
         this._scAxes.setRotationFromQuaternion(this._scQuaternion);
         if (this._scModel) {
            this._scModel.setRotationFromQuaternion(this._scQuaternion);
         }
      }

      /* Sun direction */
      if (state.svn) {
         this._sunDirection.copy(nDirToThree(state.svn)).normalize();

         if (this.earth.material.uniforms) {
            this.earth.material.uniforms.uSunDirection.value.copy(this._sunDirection);
         }
         if (this.atmosphere.material.uniforms) {
            this.atmosphere.material.uniforms.uSunDirection.value.copy(this._sunDirection);
         }
         this._dirLight.position.copy(this._sunDirection);
      }

      /* Camera tracking */
      this._updateCamera(state);

      /* HUD */
      this.hud.update(state);
   }

   /* ------------------------------------------------------------------ */
   /* Resize + render loop                                                */
   /* ------------------------------------------------------------------ */

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
      this._animId = requestAnimationFrame(() => this._animate());
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
   }

   dispose() {
      this._isAnimating = false;
      if (this._animId) cancelAnimationFrame(this._animId);
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this.hud.dispose();
      if (this.renderer) {
         this.renderer.dispose();
         this.renderer.domElement.remove();
      }
   }
}

/* ================================================================== */
/* MapView — 2D Mercator Ground Track                                  */
/* Equivalent to DrawMap() in 42gl.c                                   */
/* ================================================================== */

class MapView {
   /**
    * @param {HTMLElement} containerEl
    * @param {FortyTwoGL} gl42
    * @param {object} opts
    * @param {string} opts.mapTexture — World/ filename for map background
    */
   constructor(containerEl, gl42, opts = {}) {
      this.container = containerEl;
      this.gl42 = gl42;
      this.opts = opts;

      /* Canvas */
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'width:100%;height:100%;display:block;';
      this.ctx = this.canvas.getContext('2d');
      this.container.appendChild(this.canvas);

      /* Map background image (loaded async from PPM) */
      this._mapBitmap = null;
      this._loadMapTexture(opts.mapTexture || 'BlueMarble2.ppm');

      /* Ground track history (ring buffer) */
      this._trackMax = 10000;
      this._track = []; /* { lat, lng } */

      /* State */
      this._sunECEF = [1, 0, 0]; /* sun direction in ECEF for terminator */
      this._scLat = 0;
      this._scLng = 0;
      this._simTime = 0;

      /* Map viewport (computed in _onResize, 2:1 Mercator aspect ratio) */
      this._mapX = 0;
      this._mapY = 0;
      this._mapW = 0;
      this._mapH = 0;

      /* Resize */
      this._resizeObserver = new ResizeObserver(() => this._onResize());
      this._resizeObserver.observe(this.container);
      this._onResize();
   }

   /* ------------------------------------------------------------------ */
   /* Map texture                                                         */
   /* ------------------------------------------------------------------ */

   async _loadMapTexture(textureFile) {
      try {
         const basePath = this.gl42.opts.textureBase || '/api/files/raw/World';
         const imageData = await loadPpmImageData(`${basePath}/${textureFile}`);

         /* Convert ImageData to ImageBitmap for efficient canvas drawing */
         this._mapBitmap = await createImageBitmap(imageData);
         this._draw();
      } catch (e) {
         console.warn('[42gl] Map texture unavailable, using solid background');
      }
   }

   /* ------------------------------------------------------------------ */
   /* State update                                                        */
   /* ------------------------------------------------------------------ */

   update(state) {
      if (!state || !state.posN) return;
      this._simTime = state.simTime || 0;

      /* Earth rotation angle */
      const theta = EARTH_ROT_RATE * this._simTime;

      /* SC sub-satellite point */
      const geo = eciToLatLng(state.posN, theta);
      this._scLat = geo.lat;
      this._scLng = geo.lng;

      /* Add to track */
      this._track.push({ lat: geo.lat, lng: geo.lng });
      if (this._track.length > this._trackMax) {
         this._track.shift();
      }

      /* Sun direction in ECEF for terminator */
      if (state.svn) {
         this._sunECEF = eciToEcef(state.svn, theta);
      }

      /* Redraw */
      this._draw();
   }

   /* ------------------------------------------------------------------ */
   /* Canvas rendering                                                    */
   /* ------------------------------------------------------------------ */

   _draw() {
      const ctx = this.ctx;
      /* Use CSS dimensions since setTransform scales to device pixels */
      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      if (cw === 0 || ch === 0) return;

      /* Clear full canvas with dark background (letterbox fill) */
      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, cw, ch);

      /* Draw map texture into the 2:1 viewport */
      if (this._mapBitmap) {
         ctx.drawImage(this._mapBitmap, this._mapX, this._mapY, this._mapW, this._mapH);
      }

      /* Clip to map viewport for overlays */
      ctx.save();
      ctx.beginPath();
      ctx.rect(this._mapX, this._mapY, this._mapW, this._mapH);
      ctx.clip();

      this._drawTerminator(ctx);
      this._drawGrid(ctx);
      this._drawTrack(ctx);
      this._drawSCMarker(ctx);
      this._drawSunMarker(ctx);

      ctx.restore();

      /* Clock drawn outside clip (positioned relative to viewport) */
      this._drawClock(ctx);
   }

   /** Convert lat/lng (deg) to canvas pixel coordinates within the map viewport. */
   _toCanvas(lng, lat) {
      return {
         x: this._mapX + (lng + 180) / 360 * this._mapW,
         y: this._mapY + (90 - lat) / 180 * this._mapH,
      };
   }

   /** Day/night terminator (cf. DrawMap() day/night shader in 42gl.c).
    *  Semi-transparent dark overlay on the night side. */
   _drawTerminator(ctx) {
      const sx = this._sunECEF[0];
      const sy = this._sunECEF[1];
      const sz = this._sunECEF[2];
      const mx = this._mapX, my = this._mapY, mw = this._mapW, mh = this._mapH;

      /* Compute terminator curve: for each longitude, find latitude where sunDot=0 */
      ctx.beginPath();
      let started = false;

      for (let lngDeg = -180; lngDeg <= 180; lngDeg += 1) {
         const lngRad = lngDeg * DEG2RAD;
         const horiz = Math.cos(lngRad) * sx + Math.sin(lngRad) * sy;

         let latDeg;
         if (Math.abs(sz) < 1e-10) {
            /* Sun in equatorial plane — terminator at poles */
            latDeg = (horiz >= 0) ? 90 : -90;
         } else {
            latDeg = Math.atan(-horiz / sz) * RAD2DEG;
         }

         const p = this._toCanvas(lngDeg, latDeg);
         if (!started) { ctx.moveTo(p.x, p.y); started = true; }
         else ctx.lineTo(p.x, p.y);
      }

      /* Close the night-side polygon.
         Night side is where sunDot < 0. When sz > 0 (sun above equator),
         night side is below the terminator curve (toward south pole). */
      if (sz >= 0) {
         /* Night is below: extend to bottom-right → bottom-left */
         ctx.lineTo(mx + mw, my + mh);
         ctx.lineTo(mx, my + mh);
      } else {
         /* Night is above: extend to top-right → top-left */
         ctx.lineTo(mx + mw, my);
         ctx.lineTo(mx, my);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fill();
   }

   /** Lat/lng grid (15° minor, 45° major — matching 42's DrawMap). */
   _drawGrid(ctx) {
      const mx = this._mapX, my = this._mapY, mw = this._mapW, mh = this._mapH;

      /* Minor grid: 15° spacing */
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 0.5;
      for (let lat = -75; lat <= 75; lat += 15) {
         const y = my + (90 - lat) / 180 * mh;
         ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx + mw, y); ctx.stroke();
      }
      for (let lng = -165; lng <= 165; lng += 15) {
         const x = mx + (lng + 180) / 360 * mw;
         ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my + mh); ctx.stroke();
      }

      /* Major grid: 45° spacing */
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      for (let lat = -45; lat <= 45; lat += 45) {
         const y = my + (90 - lat) / 180 * mh;
         ctx.beginPath(); ctx.moveTo(mx, y); ctx.lineTo(mx + mw, y); ctx.stroke();
      }
      for (let lng = -135; lng <= 135; lng += 45) {
         const x = mx + (lng + 180) / 360 * mw;
         ctx.beginPath(); ctx.moveTo(x, my); ctx.lineTo(x, my + mh); ctx.stroke();
      }

      /* Equator and prime meridian */
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      const eqY = my + mh / 2;
      ctx.beginPath(); ctx.moveTo(mx, eqY); ctx.lineTo(mx + mw, eqY); ctx.stroke();
      const pmX = mx + mw / 2;
      ctx.beginPath(); ctx.moveTo(pmX, my); ctx.lineTo(pmX, my + mh); ctx.stroke();
   }

   /** Ground track (accumulated SC positions). */
   _drawTrack(ctx) {
      if (this._track.length < 2) return;

      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      let prev = this._track[0];
      let pp = this._toCanvas(prev.lng, prev.lat);
      ctx.moveTo(pp.x, pp.y);

      for (let i = 1; i < this._track.length; i++) {
         const cur = this._track[i];
         const cp = this._toCanvas(cur.lng, cur.lat);

         /* Break line at ±180° wrap-around */
         if (Math.abs(cur.lng - prev.lng) > 180) {
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(cp.x, cp.y);
         } else {
            ctx.lineTo(cp.x, cp.y);
         }
         prev = cur;
      }
      ctx.stroke();
   }

   /** Sub-satellite point marker (yellow circle + crosshair). */
   _drawSCMarker(ctx) {
      if (this._track.length === 0) return;

      const p = this._toCanvas(this._scLng, this._scLat);
      const r = 5;

      /* Yellow filled circle */
      ctx.fillStyle = '#f9e2af';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      /* Crosshair */
      ctx.strokeStyle = '#f9e2af';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - r * 2, p.y); ctx.lineTo(p.x + r * 2, p.y);
      ctx.moveTo(p.x, p.y - r * 2); ctx.lineTo(p.x, p.y + r * 2);
      ctx.stroke();

      /* Horizon circle (approximate as ellipse on Mercator — not geodesically correct) */
      if (this._track.length > 0) {
         const posN = this.gl42._lastState?.posN;
         if (posN) {
            const r_m = Math.sqrt(posN[0] ** 2 + posN[1] ** 2 + posN[2] ** 2);
            const horizAngle = Math.acos(EARTH_RADIUS_KM * 1000 / r_m) * RAD2DEG;
            const horizRadX = horizAngle / 360 * this._mapW;
            const horizRadY = horizAngle / 180 * this._mapH;

            ctx.strokeStyle = 'rgba(250, 179, 135, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, horizRadX, horizRadY, 0, 0, Math.PI * 2);
            ctx.stroke();
         }
      }
   }

   /** Sub-solar point marker (gold star). */
   _drawSunMarker(ctx) {
      const sx = this._sunECEF[0], sy = this._sunECEF[1], sz = this._sunECEF[2];
      const sunLat = Math.asin(sz) * RAD2DEG;
      const sunLng = Math.atan2(sy, sx) * RAD2DEG;
      const p = this._toCanvas(sunLng, sunLat);

      /* Gold circle */
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();

      /* Inner white dot */
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
   }

   /** Clock overlay (positioned relative to map viewport). */
   _drawClock(ctx) {
      const mx = this._mapX, my = this._mapY, mw = this._mapW, mh = this._mapH;
      const timeStr = `T+${fmtHMS(this._simTime)}`;

      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(205, 214, 244, 0.8)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(timeStr, mx + mw - 8, my + 8);

      /* Lat/lng readout */
      if (this._track.length > 0) {
         const latStr = `${this._scLat >= 0 ? 'N' : 'S'}${Math.abs(this._scLat).toFixed(1)}`;
         const lngStr = `${this._scLng >= 0 ? 'E' : 'W'}${Math.abs(this._scLng).toFixed(1)}`;
         ctx.fillText(`${latStr} ${lngStr}`, mx + mw - 8, my + 24);
      }

      /* Credits (bottom-left, matching 42's DrawCredits) */
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(127, 132, 156, 0.6)';
      ctx.fillText('42 — Eric Stoneking, NASA GSFC', mx + 8, my + mh - 4);
   }

   /* ------------------------------------------------------------------ */
   /* Resize                                                              */
   /* ------------------------------------------------------------------ */

   _onResize() {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w === 0 || h === 0) return;

      /* Set canvas resolution to match display size */
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      /* Compute map viewport: fit 2:1 Mercator rectangle, centered */
      const MAP_AR = 2; /* Mercator: width / height = 2 */
      const containerAR = w / h;
      if (containerAR > MAP_AR) {
         this._mapH = h;
         this._mapW = h * MAP_AR;
      } else {
         this._mapW = w;
         this._mapH = w / MAP_AR;
      }
      this._mapX = (w - this._mapW) / 2;
      this._mapY = (h - this._mapH) / 2;

      /* Redraw at new size */
      this._draw();
   }

   clearTrack() {
      this._track = [];
      this._draw();
   }

   dispose() {
      if (this._resizeObserver) this._resizeObserver.disconnect();
      this.canvas.remove();
   }
}

/* ================================================================== */
/* HUD Overlay                                                         */
/* HTML overlay for the 3D view — clock, camera mode, frame info.      */
/* Equivalent to 42's raster-font HUD in CamRenderExec.               */
/* ================================================================== */

class HUDOverlay {
   constructor(containerEl) {
      this.el = document.createElement('div');
      this.el.style.cssText = `
         position: absolute;
         inset: 0;
         pointer-events: none;
         font-family: 'SF Mono', 'Fira Code', Consolas, monospace;
         font-size: 12px;
         color: rgba(205, 214, 244, 0.8);
         z-index: 10;
      `;

      /* Clock (top-right) */
      this._clock = document.createElement('div');
      this._clock.style.cssText = 'position:absolute;top:8px;right:12px;text-align:right;';
      this.el.appendChild(this._clock);

      /* Camera info (bottom-left) */
      this._camInfo = document.createElement('div');
      this._camInfo.style.cssText = 'position:absolute;bottom:8px;left:12px;';
      this.el.appendChild(this._camInfo);

      /* State info (top-left) */
      this._stateInfo = document.createElement('div');
      this._stateInfo.style.cssText = 'position:absolute;top:8px;left:12px;';
      this.el.appendChild(this._stateInfo);

      /* Credits (bottom-right) */
      this._credits = document.createElement('div');
      this._credits.style.cssText = 'position:absolute;bottom:8px;right:12px;text-align:right;color:rgba(127,132,156,0.5);font-size:10px;';
      this._credits.textContent = '42 — Eric Stoneking, NASA GSFC';
      this.el.appendChild(this._credits);

      /* Make container position:relative for absolute children */
      if (getComputedStyle(containerEl).position === 'static') {
         containerEl.style.position = 'relative';
      }
      containerEl.appendChild(this.el);

      this._camMode = CAM_MODE.FREE;
   }

   setCamMode(mode) {
      this._camMode = mode;
      const names = { [CAM_MODE.FREE]: 'Free Camera', [CAM_MODE.TRACK_SC]: 'Track SC', [CAM_MODE.TRACK_SC_BODY]: 'Body Frame' };
      this._camInfo.textContent = names[mode] || 'Free Camera';
   }

   update(state) {
      if (!state) return;

      /* Clock */
      const t = state.simTime || 0;
      this._clock.textContent = `T+${fmtHMS(t)}`;

      /* State readout */
      const lines = [];
      if (state.posN) {
         const r = Math.sqrt(state.posN[0] ** 2 + state.posN[1] ** 2 + state.posN[2] ** 2);
         const alt = (r / 1000) - EARTH_RADIUS_KM;
         lines.push(`Alt: ${alt.toFixed(1)} km`);
      }
      if (state.velN) {
         const v = Math.sqrt(state.velN[0] ** 2 + state.velN[1] ** 2 + state.velN[2] ** 2);
         lines.push(`Vel: ${(v / 1000).toFixed(3)} km/s`);
      }
      if (state.wn) {
         const w = Math.sqrt(state.wn[0] ** 2 + state.wn[1] ** 2 + state.wn[2] ** 2);
         lines.push(`\u03C9: ${(w * RAD2DEG).toFixed(3)} \u00B0/s`);
      }
      this._stateInfo.innerHTML = lines.join('<br>');
   }

   dispose() {
      this.el.remove();
   }
}

/* ================================================================== */
/* FortyTwoGL — Main Orchestrator                                      */
/* ================================================================== */

/**
 * FortyTwoGL — Top-level rendering engine for the 42 web UI.
 *
 * Creates and manages CamView (3D) and MapView (2D) instances.
 * Distributes state updates to all active views.
 *
 * @param {object} opts
 * @param {string} opts.textureBase — URL prefix for World/ textures (default '/api/files/raw/World')
 * @param {string} opts.modelBase — URL prefix for Model/ files (default '/api/files/raw/Model')
 */
export class FortyTwoGL {
   constructor(opts = {}) {
      this.opts = {
         textureBase: opts.textureBase || '/api/files/raw/World',
         modelBase:   opts.modelBase   || '/api/files/raw/Model',
         ...opts,
      };

      this.camView = null;
      this.mapView = null;
      this._lastState = null;
      this._textureCache = new Map();
   }

   /**
    * Create the 3D orbital camera view.
    * @param {HTMLElement} containerEl — DOM element to render into
    * @param {object} opts — CamView options
    * @returns {CamView}
    */
   createCamView(containerEl, opts = {}) {
      this.camView = new CamView(containerEl, this, opts);
      return this.camView;
   }

   /**
    * Create the 2D Mercator ground track view.
    * @param {HTMLElement} containerEl — DOM element to render into
    * @param {object} opts — MapView options
    * @returns {MapView}
    */
   createMapView(containerEl, opts = {}) {
      this.mapView = new MapView(containerEl, this, opts);
      return this.mapView;
   }

   /**
    * Update all views with new simulation state.
    * @param {object} state — state from IPC or WASM
    * @param {number} state.simTime
    * @param {number[]} state.posN — [x,y,z] meters, ECI
    * @param {number[]} state.velN — [x,y,z] m/s, ECI
    * @param {number[]} state.qbn — [q0,q1,q2,q3] scalar-first, N→B
    * @param {number[]} state.svn — [x,y,z] unit sun vector, ECI
    * @param {number[]} state.wn — [x,y,z] angular velocity, rad/s
    * @param {number[][]} state.trailPoints — batch of posN arrays
    */
   update(state) {
      this._lastState = state;
      if (this.camView) this.camView.update(state);
      if (this.mapView) this.mapView.update(state);
   }

   /**
    * Clear all trail/track data (e.g. on simulation reset).
    */
   clearTrails() {
      if (this.camView) this.camView.clearTrail();
      if (this.mapView) this.mapView.clearTrack();
   }

   /**
    * Load a spacecraft OBJ model into the 3D view.
    * @param {string} modelName — base name (e.g. 'IonCruiser', 'HST')
    */
   async loadModel(modelName) {
      if (this.camView) {
         await this.camView.loadModel(modelName, this.opts.modelBase);
      }
   }

   /**
    * Set camera mode for the 3D view.
    * @param {number} mode — CAM_MODE constant
    */
   setCameraMode(mode) {
      if (this.camView) this.camView.setCameraMode(mode);
   }

   /**
    * Dispose all views and release resources.
    */
   dispose() {
      if (this.camView) this.camView.dispose();
      if (this.mapView) this.mapView.dispose();
      this._textureCache.forEach(tex => tex.dispose());
      this._textureCache.clear();
   }
}
