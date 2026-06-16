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
import { ServerSync } from './core/ServerSync.js';
import { ServerBackend } from './core/ServerBackend.js';

/* ------------------------------------------------------------------ */
/* Backend mode: 'wasm' (client-side) or 'server' (native)            */
/* ------------------------------------------------------------------ */
const BACKEND_MODE = window.__42_MODE || 'wasm';

/* ------------------------------------------------------------------ */
/* Session ID                                                          */
/* ------------------------------------------------------------------ */
function sessionTimestamp(d) {
   const p = (n, w) => String(n).padStart(w, '0');
   return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1,2)}-${p(d.getUTCDate(),2)}`
      + `T${p(d.getUTCHours(),2)}${p(d.getUTCMinutes(),2)}${p(d.getUTCSeconds(),2)}`
      + `.${p(d.getUTCMilliseconds(),3)}`;
}

const SESSION_ID = (() => {
   const stored = sessionStorage.getItem('42-session-id');
   if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
      return stored;
   }
   const id = crypto.randomUUID();
   sessionStorage.setItem('42-session-id', id);
   return id;
})();

const SESSION_TS = (() => {
   const stored = sessionStorage.getItem('42-session-ts');
   if (stored) return stored;
   const ts = sessionTimestamp(new Date());
   sessionStorage.setItem('42-session-ts', ts);
   return ts;
})();

/* ------------------------------------------------------------------ */
/* Service Worker (WASM mode only — caches .wasm/.data files)          */
/* ------------------------------------------------------------------ */
if (BACKEND_MODE === 'wasm' && 'serviceWorker' in navigator) {
   navigator.serviceWorker.register(`sw.js?sid=${SESSION_ID}&sts=${SESSION_TS}`)
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
let pendingFlush = false;  /* true while flushing outputs to server */
let autoRunAfterReady = false; /* set when re-running from 'done' in WASM mode */

/* ------------------------------------------------------------------ */
/* Server Sync (optional — active when InOut/ volume is mounted)       */
/* ------------------------------------------------------------------ */
const serverSync = new ServerSync(SESSION_ID, SESSION_TS);
const syncIndicator = document.getElementById('sync-indicator');
const flushBtn = document.getElementById('btn-flush');

function updateSyncIndicator(state) {
   if (!syncIndicator) return;
   syncIndicator.className = state; /* sync-on, sync-off, sync-busy, sync-error */
}

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
/* Worker / ServerBackend lifecycle                                    */
/* ------------------------------------------------------------------ */

function createWorker() {
   if (worker) {
      worker.terminate();
   }

   if (BACKEND_MODE === 'server') {
      worker = new ServerBackend();
   } else {
      worker = new Worker('core/SimWorker.js');
   }
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
               /* Auto-run if re-running from 'done' state */
               if (autoRunAfterReady) {
                  autoRunAfterReady = false;
                  worker.postMessage({ type: 'RUN', stepsPerBatch: controlPanel._stepsPerBatch });
               }
            }
            if (msg.status === 'done') {
               consolePanel.appendLine('[42] Simulation complete', 'info');
               if (BACKEND_MODE === 'server') {
                  /* Refresh file browser to show output files written by 42 */
                  fileBrowser.setReady();
               } else if (serverSync.available) {
                  consolePanel.appendLine('[Server] Auto-flushing outputs to host...', 'info');
                  flushOutputs();
               }
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

            /* Handle flush: bulk-write files to server */
            if (pendingFlush && serverSync.available) {
               pendingFlush = false;
               const filesToSync = [];
               for (const [p, content] of Object.entries(msg.files)) {
                  if (content != null) {
                     filesToSync.push({ path: serverSync.toRelPath(p), content });
                  }
               }
               if (filesToSync.length > 0) {
                  updateSyncIndicator('sync-busy');
                  serverSync.syncFiles(filesToSync).then(result => {
                     if (result.success) {
                        consolePanel.appendLine(`[Server] Flushed ${result.written.length} files to host`, 'info');
                        updateSyncIndicator('sync-on');
                     } else {
                        consolePanel.appendLine(`[Server] Flush errors: ${JSON.stringify(result.errors || result.error)}`, 'stderr');
                        updateSyncIndicator('sync-error');
                     }
                  });
               }
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
         /* In WASM mode, dual-write to server if available */
         if (BACKEND_MODE === 'wasm' && serverSync.available) {
            editor.setSyncStatus('syncing');
            serverSync.writeFile(serverSync.toRelPath(p), c).then(result => {
               editor.setSyncStatus(result.success ? 'synced' : 'error');
               if (result.success) {
                  consolePanel.appendLine(`[Server] Synced: ${p}`, 'info');
               } else {
                  consolePanel.appendLine(`[Server] Sync failed: ${p} — ${result.error}`, 'stderr');
               }
            });
         }
      },
      onSaveAndRun: (p, c) => {
         worker.postMessage({ type: 'WRITE_FILE', path: p, content: c });
         if (BACKEND_MODE === 'wasm' && serverSync.available) {
            serverSync.writeFile(serverSync.toRelPath(p), c);
         }
         consolePanel.appendLine('[42-web] Save & Run: resetting simulation...', 'info');
         resetSimulation();
         /* After reset, auto-init and run */
         setTimeout(() => {
            worker.postMessage({ type: 'INIT' });
         }, 100);
      },
   });
   if (BACKEND_MODE === 'server') {
      editor.setSyncStatus('synced'); /* files are always on disk in server mode */
   } else if (!serverSync.available) {
      editor.setSyncStatus('unavailable');
   }

   tabManager.addTab(tabId, fileName, editor.el, true, { editor, path }, '\u{1F4C4}');
}

/* ------------------------------------------------------------------ */
/* Parse Inp_Sim.txt for config values                                 */
/* ------------------------------------------------------------------ */

function parseSimConfig(text) {
   const lines = text.split('\n');
   let dtSim = null;
   for (const line of lines) {
      /* Look for STOPTIME - typical 42 format has values before labels */
      if (/STOPTIME/i.test(line)) {
         const match = line.match(/([\d.eE+-]+)/);
         if (match) {
            stopTime = parseFloat(match[1]);
         }
      }
      /* Look for DTSIM or TIMESTEP */
      if (/DTSIM|TIMESTEP/i.test(line)) {
         const match = line.match(/([\d.eE+-]+)/);
         if (match) {
            dtSim = parseFloat(match[1]);
         }
      }
   }
   /* Update Config panel immediately with parsed values */
   const stopEl = document.querySelector('#cfg-stoptime');
   if (stopEl && stopTime > 0) stopEl.value = stopTime.toFixed(0) + ' sec';
   const dtEl = document.querySelector('#cfg-dtsim');
   if (dtEl && dtSim != null) dtEl.value = dtSim + ' sec';
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

controlPanel.onRun = () => {
   if (controlPanel.status === 'done') {
      if (BACKEND_MODE === 'wasm') {
         /* WASM: re-init in-place (reuses compiled module + MEMFS) */
         consolePanel.appendLine('[42-web] Re-initializing for new run...', 'info');
         trail.clear();
         scView.setVisible(false);
         statePanel.update(null, 0);
         autoRunAfterReady = true;
         worker.postMessage({ type: 'REINIT' });
      } else {
         /* Server: just start again (server kills old process) */
         trail.clear();
         scView.setVisible(false);
         statePanel.update(null, 0);
         worker.postMessage({ type: 'RUN', stepsPerBatch: controlPanel._stepsPerBatch });
      }
   } else {
      worker.postMessage({ type: 'RUN', stepsPerBatch: controlPanel._stepsPerBatch });
   }
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
/* Flush outputs to server                                             */
/* ------------------------------------------------------------------ */
flushBtn?.addEventListener('click', () => flushOutputs());

function flushOutputs() {
   if (!serverSync.available || !worker) return;

   /* Ask Worker for directory listing, then request all output files */
   const handler = (e) => {
      const msg = e.data;
      if (msg.type === 'DIR_LIST' && msg.path === '/InOut') {
         worker.removeEventListener('message', handler);
         /* Get all non-directory files */
         const filePaths = msg.entries
            .filter(entry => !entry.isDir)
            .map(entry => '/InOut/' + entry.name);
         if (filePaths.length === 0) {
            consolePanel.appendLine('[Server] No files to flush', 'info');
            return;
         }
         pendingFlush = true;
         worker.postMessage({ type: 'GET_FILES', paths: filePaths });
      }
   };
   worker.addEventListener('message', handler);
   worker.postMessage({ type: 'LIST_DIR', path: '/InOut' });
   consolePanel.appendLine('[Server] Flushing outputs...', 'info');
   updateSyncIndicator('sync-busy');
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */
createWorker();
controlPanel.setStatus('loading');
consolePanel.appendLine(`[42-web] Mode: ${BACKEND_MODE}`, 'info');
consolePanel.appendLine(`[42-web] Session Date Time: ${SESSION_TS}`, 'info');
consolePanel.appendLine(`[42-web] Session: ${SESSION_ID}`, 'info');

if (BACKEND_MODE === 'server') {
   /* Server mode: files on disk, auto-connect, no flush needed */
   consolePanel.appendLine('[42-web] Connecting to server backend...', 'info');
   updateSyncIndicator('sync-on');
   if (flushBtn) flushBtn.style.display = 'none';
   const resetBtn = document.getElementById('btn-reset');
   if (resetBtn) resetBtn.style.display = 'none';
   worker.postMessage({ type: 'INIT' });
} else {
   /* WASM mode: wait for user to click Init */
   consolePanel.appendLine('[42-web] UI loaded, waiting for WASM initialization...', 'info');
   /* Check server sync availability */
   serverSync.checkAvailability().then(available => {
      if (available) {
         updateSyncIndicator('sync-on');
         if (flushBtn) flushBtn.disabled = false;
         consolePanel.appendLine('[Server] InOut/ volume mounted — server sync enabled', 'info');
      } else {
         updateSyncIndicator('sync-off');
         consolePanel.appendLine('[Server] No InOut/ volume mounted — MEMFS only', 'info');
      }
   });
}

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
         Select an input file to open in the editor.
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
