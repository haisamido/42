/**
 * main.js — Bootstrap the 42 Web UI.
 *
 * Central orchestrator: wires Worker, Three.js viewer, TabManager,
 * file browser, file editors, resize handles, dialogs, and all panels.
 */

import { SceneManager } from './viewer/SceneManager.js';
import { OrbitTrail } from './viewer/OrbitTrail.js';
import { SpacecraftView } from './viewer/SpacecraftView.js';
import { TabManager } from './widgets/TabManager.js';
import { ControlPanel } from './panels/ControlPanel.js';
import { StatePanel } from './panels/StatePanel.js';
import { ConsolePanel, SimConfigPanel } from './panels/ConfigPanel.js';
import { FileBrowser } from './panels/FileBrowser.js';
import { FileEditor } from './panels/FileEditor.js';

/* ------------------------------------------------------------------ */
/* Session ID                                                          */
/* ------------------------------------------------------------------ */
const SESSION_ID = sessionStorage.getItem('42-session-id') ||
   (() => {
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      sessionStorage.setItem('42-session-id', id);
      return id;
   })();

/* ------------------------------------------------------------------ */
/* Service Worker                                                      */
/* ------------------------------------------------------------------ */
if ('serviceWorker' in navigator) {
   navigator.serviceWorker.register(`sw.js?sid=${SESSION_ID}`)
      .then(reg => console.log('[SW] Registered:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
}

/* ------------------------------------------------------------------ */
/* Three.js Viewer (permanent "3D View" tab)                           */
/* ------------------------------------------------------------------ */
const viewerEl = document.createElement('div');
viewerEl.id = 'viewer-container';
viewerEl.style.cssText = 'width:100%;height:100%;flex:1;';

const scene = new SceneManager(viewerEl);
const earthVS = document.getElementById('earthVertexShader')?.textContent;
const earthFS = document.getElementById('earthFragmentShader')?.textContent;
const atmosVS = document.getElementById('atmosVertexShader')?.textContent;
const atmosFS = document.getElementById('atmosFragmentShader')?.textContent;
scene.init(earthVS, earthFS, atmosVS, atmosFS);

const trail = new OrbitTrail(scene.scene, { color: 0x00ff88 });
const scView = new SpacecraftView(scene.scene, (posN) => scene.nFrameToThreeJS(posN));

/* ------------------------------------------------------------------ */
/* Tab Manager (main content area)                                     */
/* ------------------------------------------------------------------ */
const tabManager = new TabManager(
   document.getElementById('tab-bar'),
   document.getElementById('tab-content'),
);

/* Add the 3D View as permanent (non-closeable) first tab */
tabManager.addTab('3d-view', '3D View', viewerEl, false, {}, '\u{1F30D}');

/* When switching back to 3D tab, the ResizeObserver auto-detects
   container dimension changes, so no explicit resize call is needed. */

/* ------------------------------------------------------------------ */
/* Console Panel (bottom panel)                                        */
/* ------------------------------------------------------------------ */
const consolePanel = new ConsolePanel(
   document.getElementById('console-output'),
   document.getElementById('console-line-count'),
);

document.getElementById('console-clear-btn')
   ?.addEventListener('click', () => consolePanel.clear());

/* ------------------------------------------------------------------ */
/* Left Panel Tabs                                                     */
/* ------------------------------------------------------------------ */
initLeftPanelTabs();

/* ------------------------------------------------------------------ */
/* Left Panel: Files                                                   */
/* ------------------------------------------------------------------ */
let worker = null;
let stopTime = 10000;
let pendingFileTab = null; /* { path } — waiting for FILES response */

const fileBrowser = new FileBrowser(
   document.getElementById('files-panel'),
   null, /* Worker set by createWorker() */
   { onFileOpen: (path) => openFileTab(path) },
);

/* ------------------------------------------------------------------ */
/* Left Panel: State                                                   */
/* ------------------------------------------------------------------ */
const statePanel = new StatePanel(document.getElementById('state-panel'));

/* ------------------------------------------------------------------ */
/* Left Panel: Config                                                  */
/* ------------------------------------------------------------------ */
const simConfigPanel = new SimConfigPanel(document.getElementById('config-panel'));

/* ------------------------------------------------------------------ */
/* Control Panel (binds to toolbar buttons in header)                   */
/* ------------------------------------------------------------------ */
const controlPanel = new ControlPanel(null);

/* ------------------------------------------------------------------ */
/* Worker lifecycle                                                    */
/* ------------------------------------------------------------------ */

function createWorker() {
   if (worker) {
      worker.terminate();
   }

   worker = new Worker('core/SimWorker.js');
   controlPanel.setWorker(worker);
   fileBrowser.setWorker(worker);

   worker.onmessage = (e) => {
      const msg = e.data;

      switch (msg.type) {
         case 'STATUS':
            controlPanel.setStatus(msg.status);
            simConfigPanel.setStatus(
               msg.status === 'ready' ? 'Ready' :
               msg.status === 'running' ? 'Running' :
               msg.status === 'paused' ? 'Paused' :
               msg.status === 'done' ? 'Done' :
               msg.status === 'error' ? 'Error' :
               'Loading...'
            );
            if (msg.status === 'ready') {
               consolePanel.appendLine('[42] Simulation initialized', 'info');
               fileBrowser.setReady();
               /* Read stop time and dt */
               worker.postMessage({ type: 'GET_FILES', paths: ['/InOut/Inp_Sim.txt'] });
            }
            if (msg.status === 'done') {
               consolePanel.appendLine('[42] Simulation complete', 'info');
            }
            break;

         case 'STATE':
            statePanel.update(msg.state, stopTime);
            simConfigPanel.updateFromState(msg.state, stopTime);
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
            consolePanel.appendLine(msg.text, 'stdout');
            break;

         case 'STDERR':
            consolePanel.appendLine(msg.text, 'stderr');
            break;

         case 'FILES':
            /* Check if this is a response for a file editor tab */
            if (pendingFileTab && msg.files[pendingFileTab.path] != null) {
               const path = pendingFileTab.path;
               pendingFileTab = null;
               createFileEditorTab(path, msg.files[path]);
            }

            /* Parse stop time from Inp_Sim.txt if it's in the response */
            if (msg.files['/InOut/Inp_Sim.txt']) {
               parseSimConfig(msg.files['/InOut/Inp_Sim.txt']);
            }
            break;

         case 'DIR_LIST':
            fileBrowser.onDirList(msg.path, msg.entries);
            break;

         case 'FILE_WRITTEN':
            if (msg.success) {
               consolePanel.appendLine(`[File] Saved: ${msg.path}`, 'info');
            } else {
               consolePanel.appendLine(`[File] Save failed: ${msg.path} — ${msg.error}`, 'stderr');
            }
            break;
      }
   };

   worker.onerror = (err) => {
      consolePanel.appendLine('[Worker Error] ' + err.message, 'stderr');
      controlPanel.setStatus('error');
   };

   return worker;
}

/* ------------------------------------------------------------------ */
/* File tab management                                                 */
/* ------------------------------------------------------------------ */

function openFileTab(path) {
   const tabId = 'file:' + path;

   /* If already open, just activate */
   if (tabManager.has(tabId)) {
      tabManager.activate(tabId);
      return;
   }

   /* Request file content from Worker */
   pendingFileTab = { path };
   worker.postMessage({ type: 'GET_FILES', paths: [path] });
   consolePanel.appendLine(`[File] Opening: ${path}`, 'info');
}

function createFileEditorTab(path, content) {
   const tabId = 'file:' + path;
   if (tabManager.has(tabId)) {
      tabManager.activate(tabId);
      return;
   }

   const fileName = path.split('/').pop();
   const editor = new FileEditor(path, content, {
      onSave: (p, c) => {
         worker.postMessage({ type: 'WRITE_FILE', path: p, content: c });
      },
      onSaveAndRun: (p, c) => {
         worker.postMessage({ type: 'WRITE_FILE', path: p, content: c });
         consolePanel.appendLine('[42-web] Save & Run: resetting simulation...', 'info');
         resetSimulation();
         /* After reset, auto-init and run */
         setTimeout(() => {
            worker.postMessage({ type: 'INIT' });
         }, 100);
      },
   });

   tabManager.addTab(tabId, fileName, editor.el, true, { editor, path }, '\u{1F4C4}');
}

/* ------------------------------------------------------------------ */
/* Parse Inp_Sim.txt for config values                                 */
/* ------------------------------------------------------------------ */

function parseSimConfig(text) {
   const lines = text.split('\n');
   for (const line of lines) {
      /* Look for STOPTIME - typical 42 format has values before labels */
      if (/STOPTIME/i.test(line)) {
         const match = line.match(/([\d.eE+-]+)/);
         if (match) {
            stopTime = parseFloat(match[1]);
         }
      }
   }
}

/* ------------------------------------------------------------------ */
/* Reset handler                                                       */
/* ------------------------------------------------------------------ */

function resetSimulation() {
   trail.clear();
   scView.setVisible(false);
   statePanel.update(null, 0);
   stopTime = 10000;
   createWorker();
   controlPanel.setStatus('loading');
}

controlPanel.onReset = () => {
   consolePanel.appendLine('[42-web] Resetting simulation...', 'info');
   resetSimulation();
   consolePanel.appendLine('[42-web] Worker restarted. Click Init to begin.', 'info');
};

/* ------------------------------------------------------------------ */
/* Resize handles                                                      */
/* ------------------------------------------------------------------ */
initResizeHandles();

/* ------------------------------------------------------------------ */
/* Sample loading dialog                                               */
/* ------------------------------------------------------------------ */
document.getElementById('btn-load-sample')
   ?.addEventListener('click', () => showSamplesDialog());

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */
createWorker();
controlPanel.setStatus('loading');
consolePanel.appendLine('[42-web] UI loaded, waiting for WASM initialization...', 'info');
consolePanel.appendLine(`[42-web] Session: ${SESSION_ID}`, 'info');

/* ================================================================== */
/* Helper: Left panel tab switching                                    */
/* ================================================================== */

function initLeftPanelTabs() {
   const tabButtons = document.querySelectorAll('.left-tab');
   const panels = document.querySelectorAll('.left-panel-content');

   tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
         const target = btn.dataset.tab;

         tabButtons.forEach(b => b.classList.toggle('active', b === btn));
         panels.forEach(p => {
            p.classList.toggle('active', p.id === target + '-panel');
         });
      });
   });
}

/* ================================================================== */
/* Helper: Resize handles (horizontal + vertical)                      */
/* ================================================================== */

function initResizeHandles() {
   /* --- Horizontal: left panel width --- */
   const hHandle = document.getElementById('resize-h');
   const leftPanel = document.getElementById('left-panel');

   if (hHandle && leftPanel) {
      let draggingH = false;

      hHandle.addEventListener('mousedown', (e) => {
         e.preventDefault();
         draggingH = true;
         document.body.style.cursor = 'col-resize';
         document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
         if (!draggingH) return;
         const newWidth = Math.max(140, Math.min(600, e.clientX));
         document.documentElement.style.setProperty('--left-width', newWidth + 'px');
         /* ResizeObserver on viewerEl handles Three.js resize */
      });

      document.addEventListener('mouseup', () => {
         if (draggingH) {
            draggingH = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            /* ResizeObserver on viewerEl handles Three.js resize */
         }
      });
   }

   /* --- Vertical: console panel height --- */
   const vHandle = document.getElementById('resize-v');
   const consoleEl = document.getElementById('console-panel');

   if (vHandle && consoleEl) {
      let draggingV = false;

      vHandle.addEventListener('mousedown', (e) => {
         e.preventDefault();
         draggingV = true;
         document.body.style.cursor = 'row-resize';
         document.body.style.userSelect = 'none';
      });

      document.addEventListener('mousemove', (e) => {
         if (!draggingV) return;
         const windowH = window.innerHeight;
         const newHeight = Math.max(80, Math.min(windowH * 0.5, windowH - e.clientY));
         consoleEl.style.height = newHeight + 'px';
         /* ResizeObserver on viewerEl handles Three.js resize */
      });

      document.addEventListener('mouseup', () => {
         if (draggingV) {
            draggingV = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            /* ResizeObserver on viewerEl handles Three.js resize */
         }
      });
   }
}

/* ================================================================== */
/* Helper: Samples dialog                                              */
/* ================================================================== */

function showSamplesDialog() {
   const overlay = document.getElementById('dialog-overlay');
   const dialogEl = document.getElementById('dialog-content');
   if (!overlay || !dialogEl) return;

   dialogEl.innerHTML = `
      <h2>Load Sample Configuration</h2>
      <p style="color:var(--subtext0);margin-bottom:12px;">
         Select an input file from MEMFS to open in the editor.
      </p>
      <div id="sample-list" style="max-height:300px;overflow-y:auto;">
         <div style="color:var(--subtext0);padding:12px;">Loading file list...</div>
      </div>
      <div style="margin-top:16px;text-align:right;">
         <button class="tb-btn" id="dialog-close-btn">Close</button>
      </div>
   `;

   overlay.classList.add('visible');

   document.getElementById('dialog-close-btn')
      .addEventListener('click', () => {
         overlay.classList.remove('visible');
      });

   overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
         overlay.classList.remove('visible');
      }
   });

   /* Request listing of /InOut to populate samples */
   if (worker) {
      const handler = (e) => {
         const msg = e.data;
         if (msg.type === 'DIR_LIST' && msg.path === '/InOut') {
            worker.removeEventListener('message', handler);
            populateSampleList(msg.entries);
         }
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'LIST_DIR', path: '/InOut' });
   }
}

function populateSampleList(entries) {
   const listEl = document.getElementById('sample-list');
   if (!listEl) return;

   const files = entries.filter(e => !e.isDir && /\.(txt|inp)$/i.test(e.name));

   if (files.length === 0) {
      listEl.innerHTML = '<div style="color:var(--subtext0);padding:12px;">No input files found. Click Init first.</div>';
      return;
   }

   listEl.innerHTML = '';
   for (const file of files) {
      const item = document.createElement('div');
      item.className = 'example-item';
      item.innerHTML = `
         <div class="example-title">\u{1F4C4} ${file.name}</div>
         <div class="example-desc">/InOut/${file.name}</div>
      `;
      item.addEventListener('click', () => {
         document.getElementById('dialog-overlay').classList.remove('visible');
         openFileTab('/InOut/' + file.name);
      });
      listEl.appendChild(item);
   }
}
