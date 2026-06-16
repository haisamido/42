/*    server.js — Native 42 server for the web UI                          */
/*    Manages 42 process lifecycle and serves files from disk.             */
/*    Port 8043 by default.                                                */

const http = require('http');
const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT       = parseInt(process.env.PORT || '8043', 10);
const ROOT_DIR   = process.env.ROOT_DIR   || path.join(__dirname);
const INOUT_DIR  = process.env.INOUT_DIR  || path.join(ROOT_DIR, 'InOut');
const MODEL_DIR  = process.env.MODEL_DIR  || path.join(ROOT_DIR, 'Model');
const WORLD_DIR  = process.env.WORLD_DIR  || path.join(ROOT_DIR, 'World');
const BIN_42     = process.env.BIN_42     || path.join(ROOT_DIR, '42');
const OVERRIDE_DIR = process.env.OVERRIDE_DIR || path.join(ROOT_DIR, 'overrides');

/* Read git commit from build artifact */
let GIT_COMMIT = 'unknown';
try {
   GIT_COMMIT = fs.readFileSync(path.join(ROOT_DIR, '.git-commit'), 'utf8').trim();
} catch (e) { /* ignore */ }

/* MIME type map */
const MIME = {
   '.html':  'text/html; charset=utf-8',
   '.css':   'text/css; charset=utf-8',
   '.js':    'application/javascript; charset=utf-8',
   '.json':  'application/json; charset=utf-8',
   '.png':   'image/png',
   '.jpg':   'image/jpeg',
   '.svg':   'image/svg+xml',
   '.ico':   'image/x-icon',
   '.txt':   'text/plain; charset=utf-8',
   '.csv':   'text/csv; charset=utf-8',
   '.ppm':   'image/x-portable-pixmap',
   '.pgm':   'image/x-portable-graymap',
   '.obj':   'text/plain; charset=utf-8',
   '.mtl':   'text/plain; charset=utf-8',
};

function getMime(filePath) {
   return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function timestamp() {
   return new Date().toISOString();
}

function logReq(req, status, size) {
   console.log(
      `${timestamp()} "${req.method} ${req.url}" ${status} ${size}`
   );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const MAX_SINGLE = 10 * 1024 * 1024;

/** Allowed top-level directories under ROOT_DIR for the file API. */
const ALLOWED_ROOTS = ['InOut', 'Model', 'World'];

/** Resolve a relative path safely within baseDir. Returns null if invalid. */
function safePath(relPath, baseDir) {
   if (!relPath || typeof relPath !== 'string') return null;
   if (relPath.indexOf('\0') !== -1) return null;
   const resolved = path.resolve(baseDir, relPath);
   if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) return null;
   return resolved;
}

/** Resolve a relative path, restricting to allowed top-level dirs under ROOT_DIR. */
function safeDataPath(relPath) {
   if (!relPath || typeof relPath !== 'string') return null;
   const top = relPath.split('/')[0];
   if (!ALLOWED_ROOTS.includes(top)) return null;
   return safePath(relPath, ROOT_DIR);
}

/** Read full request body as string, reject if over maxBytes. */
function readBody(req, maxBytes) {
   return new Promise((resolve, reject) => {
      let body = '';
      let bytes = 0;
      req.on('data', chunk => {
         bytes += chunk.length;
         if (bytes > maxBytes) { reject(new Error('Payload too large')); req.destroy(); return; }
         body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
   });
}

/** Send JSON response. */
function sendJSON(res, status, obj) {
   const body = JSON.stringify(obj);
   res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
   });
   res.end(body);
   return body.length;
}

/* ------------------------------------------------------------------ */
/* 42 Process Manager + IPC                                            */
/* ------------------------------------------------------------------ */

const IPC_PORT = parseInt(process.env.IPC_PORT || '10001', 10);
const BROADCAST_INTERVAL_MS = 33; /* ~30fps max for SSE state push */

let sim = null;    /* { proc, status, startTime, ipcClient } */
const sseClients = new Set();

function broadcastSSE(event, data) {
   const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
   for (const res of sseClients) {
      res.write(msg);
   }
}

/* ------------------------------------------------------------------ */
/* IPC Configuration Writer                                            */
/* ------------------------------------------------------------------ */

/** Write Inp_IPC.txt to INOUT_DIR before spawning 42.
 *  Configures 42 as a TCP SERVER in TX mode on IPC_PORT. */
function writeIpcConfig() {
   const content = [
      '<<<<<<<<<<<<<<< 42: InterProcess Comm Configuration File >>>>>>>>>>>>>>>>',
      `1                                       ! Number of Sockets`,
      '**********************************  IPC 0   *****************************',
      'TX                                      ! IPC Mode (OFF,TX,RX,TXRX,WRITEFILE,READFILE)',
      '"State00.42"                            ! File name for WRITE or READ',
      'SERVER                                  ! Socket Role (SERVER,CLIENT,GMSEC_CLIENT)',
      `localhost     ${IPC_PORT}               ! Server Host Name, Port`,
      'TRUE                                    ! Allow Blocking (i.e. wait on RX)',
      'FALSE                                   ! Echo to stdout',
      '2                                       ! Number of TX prefixes',
      '"SC"                                    ! Prefix 0',
      '"Orb"                                   ! Prefix 1',
   ].join('\n') + '\n';

   fs.writeFileSync(path.join(INOUT_DIR, 'Inp_IPC.txt'), content);
   console.log(`${timestamp()} Wrote Inp_IPC.txt (TX SERVER on port ${IPC_PORT})`);
}

/* ------------------------------------------------------------------ */
/* IPC Message Parser                                                  */
/* ------------------------------------------------------------------ */

/** Parse a single 42 IPC text message into a state object.
 *  Message format: lines of "VARIABLE = [values]" ending with [ENDMSG] */
function parseIpcMessage(msg) {
   const state = {
      simTime: 0,
      posN: null,
      velN: null,
      qbn: null,
      svb: null,
      svn: null,
      posR: null,
      velR: null,
      wn: null,
   };

   for (const line of msg.split('\n')) {
      const s = line.trim();
      if (!s || s === '[ENDMSG]') continue;

      /* TIME YYYY-DDD-HH:MM:SS.SSSSSSSSS */
      if (s.startsWith('TIME ')) {
         /* Convert day-of-year timestamp to seconds since epoch start.
            For the UI we just need simTime from the sim's time.42 equivalent. */
         const parts = s.slice(5).match(/^(\d+)-(\d+)-(\d+):(\d+):([\d.]+)$/);
         if (parts) {
            const doy = parseInt(parts[2]);
            const hr  = parseInt(parts[3]);
            const min = parseInt(parts[4]);
            const sec = parseFloat(parts[5]);
            /* Approximate: total seconds from start of year */
            state.simTime = (doy - 1) * 86400 + hr * 3600 + min * 60 + sec;
         }
         continue;
      }

      /* Parse bracketed vector values: "VAR = [v0 v1 v2 ...]" */
      const eqIdx = s.indexOf('=');
      if (eqIdx === -1) continue;
      const varName = s.slice(0, eqIdx).trim();
      const brk = s.indexOf('[', eqIdx);
      if (brk === -1) continue;
      const end = s.indexOf(']', brk);
      if (end === -1) continue;
      const vals = s.slice(brk + 1, end).trim().split(/\s+/).map(Number);
      if (!vals.every(isFinite)) continue;

      /* Match known variables (SC[0] only for now) */
      if (varName === 'SC[0].qn' && vals.length >= 4) state.qbn = vals.slice(0, 4);
      else if (varName === 'SC[0].wn' && vals.length >= 3) state.wn = vals.slice(0, 3);
      else if (varName === 'SC[0].PosR' && vals.length >= 3) state.posR = vals.slice(0, 3);
      else if (varName === 'SC[0].VelR' && vals.length >= 3) state.velR = vals.slice(0, 3);
      else if (varName === 'SC[0].svb' && vals.length >= 3) state.svb = vals.slice(0, 3);
      else if (varName === 'Orb[0].PosN' && vals.length >= 3) state.posN = vals.slice(0, 3);
      else if (varName === 'Orb[0].VelN' && vals.length >= 3) state.velN = vals.slice(0, 3);
   }

   /* Compute svn from svb and qbn: svn = q_conj * svb * q (quaternion rotation) */
   if (state.svb && state.qbn) {
      state.svn = quatRotate(quatConjugate(state.qbn), state.svb);
   }

   return state;
}

/** Quaternion conjugate: q = [q0, q1, q2, q3] (scalar-first) */
function quatConjugate(q) {
   return [q[0], -q[1], -q[2], -q[3]];
}

/** Rotate vector v by quaternion q (scalar-first convention).
 *  result = q * [0,v] * q_conj */
function quatRotate(q, v) {
   const [q0, q1, q2, q3] = q;
   const [vx, vy, vz] = v;
   /* Hamilton product: p = q * [0, vx, vy, vz] */
   const pw = -q1 * vx - q2 * vy - q3 * vz;
   const px =  q0 * vx + q2 * vz - q3 * vy;
   const py =  q0 * vy + q3 * vx - q1 * vz;
   const pz =  q0 * vz + q1 * vy - q2 * vx;
   /* Hamilton product: result = p * q_conj */
   return [
      pw * (-q1) + px * q0 + py * (-q3) - pz * (-q2),
      pw * (-q2) + py * q0 + pz * (-q1) - px * (-q3),
      pw * (-q3) + pz * q0 + px * (-q2) - py * (-q1),
   ];
}

/* ------------------------------------------------------------------ */
/* IPC Stream Processor                                                */
/* ------------------------------------------------------------------ */

let ipcBuffer = '';
let trailBuffer = [];
let lastBroadcastTime = 0;
let ipcSimTimeOffset = 0;   /* offset to convert DOY-based time to sim elapsed time */
let ipcFirstTime = true;

function processIpcData(chunk) {
   ipcBuffer += chunk.toString('utf8');

   let endIdx;
   while ((endIdx = ipcBuffer.indexOf('[ENDMSG]\n')) !== -1) {
      const msgText = ipcBuffer.slice(0, endIdx + '[ENDMSG]\n'.length);
      ipcBuffer = ipcBuffer.slice(endIdx + '[ENDMSG]\n'.length);

      /* Send Ack immediately to unblock 42 */
      if (sim && sim.ipcClient && !sim.ipcClient.destroyed) {
         sim.ipcClient.write('Ack\0');
      }

      /* Parse the message */
      const state = parseIpcMessage(msgText);
      if (!state.posN) continue; /* Skip incomplete messages */

      /* On first message, record time offset so simTime starts near 0 */
      if (ipcFirstTime) {
         ipcSimTimeOffset = state.simTime;
         ipcFirstTime = false;
      }
      state.simTime -= ipcSimTimeOffset;

      /* Accumulate trail points from every message */
      trailBuffer.push(state.posN);

      /* Broadcast to browser at capped rate */
      const now = Date.now();
      if (now - lastBroadcastTime >= BROADCAST_INTERVAL_MS) {
         const stop = getStopTime();
         state.done = state.simTime >= stop;
         state.trailPoints = trailBuffer;
         trailBuffer = [];
         broadcastSSE('state', state);
         lastBroadcastTime = now;
      }
   }
}

/* ------------------------------------------------------------------ */
/* IPC Connection Manager                                              */
/* ------------------------------------------------------------------ */

function connectIpc() {
   return new Promise((resolve, reject) => {
      const client = new net.Socket();
      const timeout = setTimeout(() => {
         client.destroy();
         reject(new Error('IPC connection timeout'));
      }, 15000);

      client.connect(IPC_PORT, '127.0.0.1', () => {
         clearTimeout(timeout);
         console.log(`${timestamp()} IPC connected to 42 on port ${IPC_PORT}`);
         resolve(client);
      });

      client.on('error', (err) => {
         clearTimeout(timeout);
         reject(err);
      });
   });
}

/** Retry IPC connection with delay (42 needs time to start listening). */
async function connectIpcWithRetry(maxRetries, delayMs) {
   for (let i = 0; i < maxRetries; i++) {
      try {
         return await connectIpc();
      } catch (e) {
         if (i < maxRetries - 1) {
            await new Promise(r => setTimeout(r, delayMs));
         }
      }
   }
   throw new Error(`Failed to connect to IPC after ${maxRetries} retries`);
}

/* ------------------------------------------------------------------ */
/* Simulation Lifecycle                                                */
/* ------------------------------------------------------------------ */

function startSim() {
   if (sim && sim.proc && sim.status === 'running') {
      return { success: false, error: 'Simulation already running' };
   }

   /* Re-read stopTime in case user edited Inp_Sim.txt between runs */
   cachedStopTime = null;

   /* Reset IPC state */
   ipcBuffer = '';
   trailBuffer = [];
   lastBroadcastTime = 0;
   ipcFirstTime = true;

   /* Write IPC config so 42 starts a TCP server */
   writeIpcConfig();

   const proc = spawn(BIN_42, [INOUT_DIR + '/'], {
      cwd: ROOT_DIR,
      env: { ...process.env, DISPLAY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
   });

   sim = { proc, status: 'running', startTime: timestamp(), pid: proc.pid, ipcClient: null };
   console.log(`${timestamp()} 42 started (pid ${proc.pid})`);
   broadcastSSE('status', { status: 'running', pid: proc.pid });

   proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      broadcastSSE('stdout', { text });
   });

   proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      broadcastSSE('stderr', { text });
   });

   proc.on('close', (code) => {
      console.log(`${timestamp()} 42 exited (code ${code})`);
      if (sim.ipcClient) {
         sim.ipcClient.destroy();
         sim.ipcClient = null;
      }
      sim.status = 'done';
      sim.exitCode = code;

      /* Flush remaining trail points */
      if (trailBuffer.length > 0) {
         broadcastSSE('state', { simTime: getStopTime(), done: true, trailPoints: trailBuffer,
            posN: trailBuffer[trailBuffer.length - 1], velN: [0,0,0], qbn: [1,0,0,0], svn: [1,0,0] });
         trailBuffer = [];
      }

      broadcastSSE('status', { status: 'done', exitCode: code });
   });

   proc.on('error', (err) => {
      console.error(`${timestamp()} 42 error: ${err.message}`);
      sim.status = 'error';
      sim.error = err.message;
      broadcastSSE('status', { status: 'error', error: err.message });
   });

   /* Connect to 42's IPC socket after a brief delay for 42 to init */
   connectIpcWithRetry(30, 500).then((client) => {
      sim.ipcClient = client;

      client.on('data', (chunk) => {
         processIpcData(chunk);
      });

      client.on('close', () => {
         console.log(`${timestamp()} IPC socket closed`);
         sim.ipcClient = null;
      });

      client.on('error', (err) => {
         console.error(`${timestamp()} IPC socket error: ${err.message}`);
      });
   }).catch((err) => {
      console.error(`${timestamp()} IPC connection failed: ${err.message}`);
      console.log(`${timestamp()} Falling back to file-based state polling`);
      /* Fall back to file polling if IPC fails */
      startFilePoller();
   });

   return { success: true, pid: proc.pid };
}

function stopSim() {
   if (!sim || !sim.proc || sim.status !== 'running') {
      return { success: false, error: 'No simulation running' };
   }
   if (sim.ipcClient) {
      sim.ipcClient.destroy();
      sim.ipcClient = null;
   }
   if (sim.filePoller) {
      clearInterval(sim.filePoller);
      sim.filePoller = null;
   }
   sim.proc.kill('SIGTERM');
   sim.status = 'stopping';
   broadcastSSE('status', { status: 'stopping' });
   return { success: true };
}

function getSimStatus() {
   if (!sim) return { status: 'idle' };
   return {
      status: sim.status,
      pid: sim.pid,
      startTime: sim.startTime,
      exitCode: sim.exitCode,
      error: sim.error,
      ipc: sim.ipcClient ? 'connected' : 'disconnected',
   };
}

/* ------------------------------------------------------------------ */
/* File-based fallback (used when IPC connection fails)                */
/* ------------------------------------------------------------------ */

let posNOffset = 0;

function startFilePoller() {
   if (!sim) return;
   /* Reset offset */
   try {
      const stat = fs.statSync(path.join(INOUT_DIR, 'PosN.42'));
      posNOffset = stat.size;
   } catch (e) {
      posNOffset = 0;
   }
   sim.filePoller = setInterval(() => {
      const state = getSimStateFromFiles();
      if (state) broadcastSSE('state', state);
   }, 500);
}

const TAIL_BYTES = 512;

function readLastLine(filePath) {
   let fd;
   try {
      fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size === 0) return null;
      const readSize = Math.min(TAIL_BYTES, stat.size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      const chunk = buf.toString('utf8').trimEnd();
      const nl = chunk.lastIndexOf('\n');
      return nl === -1 ? chunk : chunk.slice(nl + 1);
   } catch (e) {
      return null;
   } finally {
      if (fd !== undefined) fs.closeSync(fd);
   }
}

/** Cached stopTime — parsed once per sim start, cleared on process exit. */
let cachedStopTime = null;

function getStopTime() {
   if (cachedStopTime != null) return cachedStopTime;
   try {
      const txt = fs.readFileSync(path.join(INOUT_DIR, 'Inp_Sim.txt'), 'utf8');
      for (const line of txt.split('\n')) {
         if (/STOPTIME/i.test(line)) {
            const m = line.match(/([\d.eE+-]+)/);
            if (m) { cachedStopTime = parseFloat(m[1]); return cachedStopTime; }
            break;
         }
      }
   } catch (e) { /* ignore */ }
   return Infinity;
}

function readNewPosLines() {
   const filePath = path.join(INOUT_DIR, 'PosN.42');
   let fd;
   try {
      fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size <= posNOffset) {
         if (stat.size < posNOffset) posNOffset = 0;
         return [];
      }
      const readSize = stat.size - posNOffset;
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, posNOffset);
      const text = buf.toString('utf8');
      const nlIdx = text.lastIndexOf('\n');
      if (nlIdx === -1) return [];
      const consumed = nlIdx + 1;
      posNOffset += consumed;
      return text.slice(0, consumed).split('\n')
         .filter(l => l.trim())
         .map(line => line.trim().split(/\s+/).map(Number).slice(0, 3))
         .filter(p => p.length === 3 && p.every(isFinite));
   } catch (e) {
      return [];
   } finally {
      if (fd !== undefined) fs.closeSync(fd);
   }
}

function getSimStateFromFiles() {
   const timeLine = readLastLine(path.join(INOUT_DIR, 'time.42'));
   if (!timeLine) return null;
   const rawTime = parseFloat(timeLine);
   const stop = getStopTime();
   const simTime = (rawTime > stop) ? stop : rawTime;
   const parseLine = (file, count) => {
      const line = readLastLine(path.join(INOUT_DIR, file));
      if (!line) return new Array(count).fill(0);
      return line.trim().split(/\s+/).map(Number).slice(0, count);
   };
   const posN = parseLine('PosN.42', 3);
   const velN = parseLine('VelN.42', 3);
   const qbn  = parseLine('qbn.42', 4);
   const svn  = parseLine('svn.42', 3);
   const trailPoints = readNewPosLines();
   return { simTime, posN, velN, qbn, svn, done: rawTime > stop, trailPoints };
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
   /* CORS headers */
   res.setHeader('Access-Control-Allow-Origin', '*');
   res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

   if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
   }

   let urlPath = decodeURIComponent(req.url.split('?')[0]);
   const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;

   /* ============================================================== */
   /* Simulation API (/api/sim/*)                                     */
   /* ============================================================== */

   if (urlPath.startsWith('/api/sim/')) {

      /* GET /api/sim/status */
      if (urlPath === '/api/sim/status' && req.method === 'GET') {
         const size = sendJSON(res, 200, getSimStatus());
         logReq(req, 200, size);
         return;
      }

      /* POST /api/sim/start */
      if (urlPath === '/api/sim/start' && req.method === 'POST') {
         const result = startSim();
         const code = result.success ? 200 : 409;
         const size = sendJSON(res, code, result);
         logReq(req, code, size);
         return;
      }

      /* POST /api/sim/stop */
      if (urlPath === '/api/sim/stop' && req.method === 'POST') {
         const result = stopSim();
         const code = result.success ? 200 : 409;
         const size = sendJSON(res, code, result);
         logReq(req, code, size);
         return;
      }

      /* GET /api/sim/events — Server-Sent Events stream */
      if (urlPath === '/api/sim/events' && req.method === 'GET') {
         res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
         });
         res.write(`event: status\ndata: ${JSON.stringify(getSimStatus())}\n\n`);
         sseClients.add(res);
         req.on('close', () => sseClients.delete(res));
         logReq(req, 200, 0);
         return;
      }

      /* GET /api/sim/state — current state from output files (fallback) */
      if (urlPath === '/api/sim/state' && req.method === 'GET') {
         const state = getSimStateFromFiles();
         if (state) {
            const size = sendJSON(res, 200, state);
            logReq(req, 200, size);
         } else {
            const size = sendJSON(res, 404, { error: 'No state data available' });
            logReq(req, 404, size);
         }
         return;
      }

      const size = sendJSON(res, 404, { error: 'Unknown sim endpoint' });
      logReq(req, 404, size);
      return;
   }

   /* ============================================================== */
   /* File API (/api/files/*)                                         */
   /* ============================================================== */

   if (urlPath.startsWith('/api/files/')) {

      /* GET /api/files/status */
      if (urlPath === '/api/files/status' && req.method === 'GET') {
         const size = sendJSON(res, 200, {
            available: true,
            inoutDir: INOUT_DIR,
         });
         logReq(req, 200, size);
         return;
      }

      /* GET /api/files/list?dir=<relative-path> */
      if (urlPath === '/api/files/list' && req.method === 'GET') {
         const relDir = urlParams.get('dir') || '';

         /* Virtual root: list allowed top-level directories */
         if (!relDir || relDir === '/' || relDir === '.') {
            const entries = ALLOWED_ROOTS
               .filter(name => fs.existsSync(path.join(ROOT_DIR, name)))
               .map(name => {
                  const entry = { name, isDir: true };
                  try {
                     const st = fs.statSync(path.join(ROOT_DIR, name));
                     entry.mtime = st.mtime.toISOString();
                  } catch (e) { /* skip */ }
                  return entry;
               });
            const size = sendJSON(res, 200, { path: '/', entries });
            logReq(req, 200, size);
            return;
         }

         const dirPath = safeDataPath(relDir);
         if (!dirPath) {
            const size = sendJSON(res, 400, { error: 'Invalid path' });
            logReq(req, 400, size);
            return;
         }
         try {
            const dirents = fs.readdirSync(dirPath, { withFileTypes: true });
            const entries = dirents.map(d => {
               const entry = { name: d.name, isDir: d.isDirectory() };
               try {
                  const st = fs.statSync(path.join(dirPath, d.name));
                  entry.size = st.size;
                  entry.mtime = st.mtime.toISOString();
               } catch (e) { /* skip stats */ }
               return entry;
            }).sort((a, b) => {
               if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
               return a.name.localeCompare(b.name);
            });
            const size = sendJSON(res, 200, { path: relDir || '/', entries });
            logReq(req, 200, size);
         } catch (e) {
            const size = sendJSON(res, 404, { error: 'Directory not found' });
            logReq(req, 404, size);
         }
         return;
      }

      /* GET /api/files/read?path=<relative-path> */
      if (urlPath === '/api/files/read' && req.method === 'GET') {
         const relPath = urlParams.get('path');
         if (!relPath) {
            const size = sendJSON(res, 400, { error: 'Missing path parameter' });
            logReq(req, 400, size);
            return;
         }
         const filePath = safeDataPath(relPath);
         if (!filePath) {
            const size = sendJSON(res, 400, { error: 'Invalid path' });
            logReq(req, 400, size);
            return;
         }
         try {
            const stat = fs.statSync(filePath);
            if (stat.size > MAX_SINGLE) {
               const size = sendJSON(res, 413, { error: 'File too large' });
               logReq(req, 413, size);
               return;
            }
            const content = fs.readFileSync(filePath, 'utf8');
            const size = sendJSON(res, 200, { path: relPath, content });
            logReq(req, 200, size);
         } catch (e) {
            const size = sendJSON(res, 404, { error: 'File not found' });
            logReq(req, 404, size);
         }
         return;
      }

      /* POST /api/files/write — { path, content } */
      if (urlPath === '/api/files/write' && req.method === 'POST') {
         try {
            const raw = await readBody(req, MAX_SINGLE);
            const { path: relPath, content } = JSON.parse(raw);
            const filePath = safeDataPath(relPath);
            if (!filePath) {
               const size = sendJSON(res, 400, { error: 'Invalid path' });
               logReq(req, 400, size);
               return;
            }
            /* Only allow writes to InOut/, not Model/ */
            if (!relPath.startsWith('InOut')) {
               const size = sendJSON(res, 403, { error: 'Write not allowed outside InOut/' });
               logReq(req, 403, size);
               return;
            }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, 'utf8');
            const size = sendJSON(res, 200, { success: true, path: relPath });
            logReq(req, 200, size);
         } catch (e) {
            const code = e.message === 'Payload too large' ? 413 : 500;
            const size = sendJSON(res, code, { error: e.message });
            logReq(req, code, size);
         }
         return;
      }

      /* GET /api/files/raw/<relative-path> — serve file as binary stream */
      if (urlPath.startsWith('/api/files/raw/') && req.method === 'GET') {
         const relPath = urlPath.slice('/api/files/raw/'.length);
         const filePath = safeDataPath(relPath);
         if (!filePath) {
            const size = sendJSON(res, 400, { error: 'Invalid path' });
            logReq(req, 400, size);
            return;
         }
         try {
            const stat = fs.statSync(filePath);
            if (!stat.isFile()) {
               const size = sendJSON(res, 404, { error: 'Not a file' });
               logReq(req, 404, size);
               return;
            }
            const mime = getMime(filePath);
            res.writeHead(200, {
               'Content-Type': mime,
               'Content-Length': stat.size,
               'Cache-Control': 'public, max-age=3600',
            });
            fs.createReadStream(filePath).pipe(res);
            logReq(req, 200, stat.size);
         } catch (e) {
            const size = sendJSON(res, 404, { error: 'File not found' });
            logReq(req, 404, size);
         }
         return;
      }

      const size = sendJSON(res, 404, { error: 'Unknown file endpoint' });
      logReq(req, 404, size);
      return;
   }

   /* ============================================================== */
   /* /api/mode — backend mode detection                              */
   /* ============================================================== */

   if (urlPath === '/api/mode') {
      const size = sendJSON(res, 200, { mode: 'server' });
      logReq(req, 200, size);
      return;
   }

   /* ============================================================== */
   /* /version endpoint                                               */
   /* ============================================================== */

   if (urlPath === '/version' || urlPath === '/version/') {
      const body = JSON.stringify({ hash: GIT_COMMIT });
      res.writeHead(200, {
         'Content-Type': 'application/json',
         'Cache-Control': 'no-store',
      });
      res.end(body);
      logReq(req, 200, body.length);
      return;
   }

   /* Redirect / to /ui/ */
   if (urlPath === '/') {
      res.writeHead(302, { 'Location': '/ui/' });
      res.end();
      logReq(req, 302, 0);
      return;
   }

   /* Map directory requests to index.html */
   if (urlPath.endsWith('/')) {
      urlPath += 'index.html';
   }

   let filePath = path.join(ROOT_DIR, urlPath);

   /* Directory traversal guard */
   if (!filePath.startsWith(ROOT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      logReq(req, 403, 0);
      return;
   }

   /* Serve file */
   fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
         res.writeHead(404, { 'Content-Type': 'text/plain' });
         res.end('Not Found');
         logReq(req, 404, 0);
         return;
      }

      const mime = getMime(filePath);
      res.writeHead(200, {
         'Content-Type': mime,
         'Content-Length': stat.size,
         'Cache-Control': 'no-store',
      });
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      logReq(req, 200, stat.size);
   });
});

/* ------------------------------------------------------------------ */
/* Runtime override merge                                              */
/* Copies files from OVERRIDE_DIR/{InOut,Model,World} over the         */
/* corresponding bind-mounted directories. Override files win.         */
/* ------------------------------------------------------------------ */

function mergeOverrides() {
   const pairs = [
      { src: path.join(OVERRIDE_DIR, 'InOut'),  dst: INOUT_DIR },
      { src: path.join(OVERRIDE_DIR, 'Model'),  dst: MODEL_DIR },
      { src: path.join(OVERRIDE_DIR, 'World'),  dst: WORLD_DIR },
   ];
   for (const { src, dst } of pairs) {
      if (!fs.existsSync(src)) continue;
      copyDirRecursive(src, dst);
   }
}

function copyDirRecursive(src, dst) {
   let entries;
   try { entries = fs.readdirSync(src, { withFileTypes: true }); }
   catch (e) { return; }
   for (const entry of entries) {
      if (entry.name === '.gitkeep') continue;
      const srcPath = path.join(src, entry.name);
      const dstPath = path.join(dst, entry.name);
      if (entry.isDirectory()) {
         fs.mkdirSync(dstPath, { recursive: true });
         copyDirRecursive(srcPath, dstPath);
      } else {
         try {
            fs.copyFileSync(srcPath, dstPath);
            console.log(`${timestamp()} Override: ${srcPath} -> ${dstPath}`);
         } catch (e) {
            console.error(`${timestamp()} Override failed: ${srcPath} -> ${dstPath}: ${e.message}`);
         }
      }
   }
}

mergeOverrides();

server.listen(PORT, () => {
   console.log(`${timestamp()} 42-web server listening on http://0.0.0.0:${PORT}`);
   console.log(`${timestamp()} Serving: ${ROOT_DIR}`);
   console.log(`${timestamp()} InOut: ${INOUT_DIR}`);
   console.log(`${timestamp()} Model: ${MODEL_DIR}`);
   console.log(`${timestamp()} World: ${WORLD_DIR}`);
   console.log(`${timestamp()} 42 binary: ${BIN_42}`);
   console.log(`${timestamp()} Git commit: ${GIT_COMMIT}`);
});
