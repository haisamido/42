/*    server.js — Native 42 server for the web UI                          */
/*    Manages 42 process lifecycle and serves files from disk.             */
/*    Port 8043 by default.                                                */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT       = parseInt(process.env.PORT || '8043', 10);
const ROOT_DIR   = process.env.ROOT_DIR   || path.join(__dirname);
const INOUT_DIR  = process.env.INOUT_DIR  || path.join(ROOT_DIR, 'InOut');
const MODEL_DIR  = process.env.MODEL_DIR  || path.join(ROOT_DIR, 'Model');
const BIN_42     = process.env.BIN_42     || path.join(ROOT_DIR, '42');

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
const ALLOWED_ROOTS = ['InOut', 'Model'];

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
/* 42 Process Manager                                                  */
/* ------------------------------------------------------------------ */

let sim = null;  /* { proc, status, startTime } */
const sseClients = new Set();

function broadcastSSE(event, data) {
   const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
   for (const res of sseClients) {
      res.write(msg);
   }
}

function startSim() {
   if (sim && sim.proc && sim.status === 'running') {
      return { success: false, error: 'Simulation already running' };
   }

   /* Re-read stopTime in case user edited Inp_Sim.txt between runs */
   cachedStopTime = null;

   const proc = spawn(BIN_42, [INOUT_DIR + '/'], {
      cwd: ROOT_DIR,
      env: { ...process.env, DISPLAY: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
   });

   sim = { proc, status: 'running', startTime: timestamp(), pid: proc.pid };
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
      sim.status = 'done';
      sim.exitCode = code;
      broadcastSSE('status', { status: 'done', exitCode: code });
   });

   proc.on('error', (err) => {
      console.error(`${timestamp()} 42 error: ${err.message}`);
      sim.status = 'error';
      sim.error = err.message;
      broadcastSSE('status', { status: 'error', error: err.message });
   });

   return { success: true, pid: proc.pid };
}

function stopSim() {
   if (!sim || !sim.proc || sim.status !== 'running') {
      return { success: false, error: 'No simulation running' };
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
   };
}

/** Read the last non-empty line of a file by reading only the tail.
 *  Reads at most `tailBytes` from the end of the file instead of the
 *  entire contents, keeping I/O constant regardless of file size. */
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

/** Read current simulation state from 42's output files. */
function getSimState() {
   const timeLine = readLastLine(path.join(INOUT_DIR, 'time.42'));
   if (!timeLine) return null;

   const rawTime = parseFloat(timeLine);
   const stop = getStopTime();
   const simTime = (rawTime > stop) ? stop : rawTime;

   const parseLine = (file, count) => {
      const line = readLastLine(path.join(INOUT_DIR, file));
      if (!line) return new Array(count).fill(0);
      const vals = line.trim().split(/\s+/).map(Number);
      return vals.slice(0, count);
   };

   const posN = parseLine('PosN.42', 3);
   const velN = parseLine('VelN.42', 3);
   const qbn  = parseLine('qbn.42', 4);
   const svn  = parseLine('svn.42', 3);

   return {
      simTime,
      posN,
      velN,
      qbn,
      svn,
      done: rawTime > stop,
   };
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

      /* GET /api/sim/state — current state from output files */
      if (urlPath === '/api/sim/state' && req.method === 'GET') {
         const state = getSimState();
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

server.listen(PORT, () => {
   console.log(`${timestamp()} 42-web server listening on http://0.0.0.0:${PORT}`);
   console.log(`${timestamp()} Serving: ${ROOT_DIR}`);
   console.log(`${timestamp()} InOut: ${INOUT_DIR}`);
   console.log(`${timestamp()} 42 binary: ${BIN_42}`);
   console.log(`${timestamp()} Git commit: ${GIT_COMMIT}`);
});
