/**
 * main.js — Bootstrap the 42 Web UI.
 *
 * Initializes the Web Worker, Three.js viewer, and UI panels.
 * Wires up message passing between Worker and UI components.
 */

import { SceneManager } from './viewer/SceneManager.js';
import { OrbitTrail } from './viewer/OrbitTrail.js';
import { SpacecraftView } from './viewer/SpacecraftView.js';
import { ControlPanel } from './panels/ControlPanel.js';
import { StatePanel } from './panels/StatePanel.js';
import { ConfigPanel } from './panels/ConfigPanel.js';
import { FileBrowser } from './panels/FileBrowser.js';

/* ------------------------------------------------------------------ */
/* Session ID (for server-side request tracking)                       */
/* ------------------------------------------------------------------ */
const SESSION_ID = sessionStorage.getItem('42-session-id') ||
   (() => {
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      sessionStorage.setItem('42-session-id', id);
      return id;
   })();

/* ------------------------------------------------------------------ */
/* Service Worker registration                                         */
/* ------------------------------------------------------------------ */
if ('serviceWorker' in navigator) {
   navigator.serviceWorker.register(`sw.js?sid=${SESSION_ID}`)
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
}

/* ------------------------------------------------------------------ */
/* Three.js viewer                                                     */
/* ------------------------------------------------------------------ */
const viewerEl = document.getElementById('viewer-container');
const scene = new SceneManager(viewerEl);

const earthVS   = document.getElementById('earthVertexShader')?.textContent;
const earthFS   = document.getElementById('earthFragmentShader')?.textContent;
const atmosVS   = document.getElementById('atmosVertexShader')?.textContent;
const atmosFS   = document.getElementById('atmosFragmentShader')?.textContent;

scene.init(earthVS, earthFS, atmosVS, atmosFS);

const trail = new OrbitTrail(scene.scene, { color: 0x00ff88 });
const scView = new SpacecraftView(scene.scene, (posN) => scene.nFrameToThreeJS(posN));

/* ------------------------------------------------------------------ */
/* UI Panels (created once; Worker reference updated on reset)         */
/* ------------------------------------------------------------------ */
let worker = null;
let stopTime = 10000;

const controlPanel = new ControlPanel(
   document.getElementById('control-panel'),
   null /* Worker set by createWorker() */
);
const statePanel = new StatePanel(document.getElementById('state-panel'));
const configPanel = new ConfigPanel(document.getElementById('console-panel'));
const fileBrowser = new FileBrowser(
   document.getElementById('file-browser-panel'),
   null /* Worker set by createWorker() */
);

/* ------------------------------------------------------------------ */
/* Worker lifecycle                                                    */
/* ------------------------------------------------------------------ */

/**
 * Create a new SimWorker and wire up message handlers.
 * Terminates any existing Worker first.
 */
function createWorker() {
   /* Terminate old Worker if it exists */
   if (worker) {
      worker.terminate();
   }

   worker = new Worker('core/SimWorker.js');

   /* Update Worker references in all panels */
   controlPanel.setWorker(worker);
   fileBrowser.setWorker(worker);

   /* Wire up message handler */
   worker.onmessage = (e) => {
      const msg = e.data;

      switch (msg.type) {
         case 'STATUS':
            controlPanel.setStatus(msg.status);
            if (msg.status === 'ready') {
               configPanel.appendLine('[42] Simulation initialized', 'stdout');
               fileBrowser.setReady();
            }
            if (msg.status === 'done') {
               configPanel.appendLine('[42] Simulation complete', 'stdout');
            }
            break;

         case 'STATE':
            statePanel.update(msg.state, stopTime);
            if (msg.state) {
               const pos = scene.nFrameToThreeJS(msg.state.posN);
               trail.addPoint(pos);
               scView.update(msg.state.posN, msg.state.qbn);

               if (msg.state.svn) {
                  scene.updateSunDirection(msg.state.svn);
               }
            }
            break;

         case 'STDOUT':
            configPanel.appendLine(msg.text, 'stdout');
            break;

         case 'STDERR':
            configPanel.appendLine(msg.text, 'stderr');
            break;

         case 'FILES':
            fileBrowser.onFileContent(msg.files);
            for (const [path, content] of Object.entries(msg.files)) {
               if (content) {
                  configPanel.appendLine(`[File] ${path}: ${content.length} bytes`, 'stdout');
               }
            }
            break;

         case 'DIR_LIST':
            fileBrowser.onDirList(msg.path, msg.entries);
            break;
      }
   };

   worker.onerror = (err) => {
      configPanel.appendLine('[Worker Error] ' + err.message, 'stderr');
      controlPanel.setStatus('error');
   };

   return worker;
}

/* ------------------------------------------------------------------ */
/* Reset handler                                                       */
/* ------------------------------------------------------------------ */
controlPanel.onReset = () => {
   configPanel.appendLine('[42-web] Resetting simulation...', 'stdout');

   /* Clear 3D viewer state */
   trail.clear();
   scView.setVisible(false);
   statePanel.update(null, 0);

   /* Create a fresh Worker (terminates old one) */
   createWorker();

   /* Reset control panel to initial state */
   controlPanel.setStatus('loading');
   configPanel.appendLine('[42-web] Worker restarted. Click Init to begin.', 'stdout');
};

/* ------------------------------------------------------------------ */
/* Initial bootstrap                                                   */
/* ------------------------------------------------------------------ */
createWorker();
controlPanel.setStatus('loading');
configPanel.appendLine('[42-web] UI loaded, waiting for WASM initialization...', 'stdout');
configPanel.appendLine(`[42-web] Session: ${SESSION_ID}`, 'stdout');
