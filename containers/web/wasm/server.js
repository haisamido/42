/*    server.js — Static file server for 42 WASM Web UI                  */
/*    Serves WASM artifacts and UI files with proper MIME types.         */
/*    Optional REST API for server-side file sync when InOut/ is mounted.*/
/*    Modeled after gmat-ui/web/server.js.                               */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT         = parseInt(process.env.PORT || '8042', 10);
const ROOT_DIR     = process.env.ROOT_DIR     || path.join(__dirname);
const SESSION_DIR  = process.env.SESSION_DIR  || path.join(__dirname, 'sessions');
const DEFAULTS_DIR = process.env.DEFAULTS_DIR || path.join(__dirname, 'defaults', 'InOut');
const WORLD_DIR    = process.env.WORLD_DIR    || path.join(ROOT_DIR, '..', 'World');
const MODEL_DIR    = process.env.MODEL_DIR    || path.join(ROOT_DIR, '..', 'Model');

/* Ensure session root directory exists */
let serverSyncAvailable = false;
try {
   fs.mkdirSync(SESSION_DIR, { recursive: true });
   serverSyncAvailable = true;
} catch (e) { /* cannot create session directory */ }

/* Read git commit from build artifact */
let GIT_COMMIT = 'unknown';
try {
   GIT_COMMIT = fs.readFileSync(path.join(ROOT_DIR, '.git-commit'), 'utf8').trim();
} catch (e) { /* ignore */ }

/* MIME type map — includes WASM-specific types */
const MIME = {
   '.html':  'text/html; charset=utf-8',
   '.css':   'text/css; charset=utf-8',
   '.js':    'application/javascript; charset=utf-8',
   '.mjs':   'application/javascript; charset=utf-8',
   '.json':  'application/json; charset=utf-8',
   '.wasm':  'application/wasm',
   '.data':  'application/octet-stream',
   '.png':   'image/png',
   '.jpg':   'image/jpeg',
   '.svg':   'image/svg+xml',
   '.ico':   'image/x-icon',
   '.txt':   'text/plain; charset=utf-8',
   '.csv':   'text/csv; charset=utf-8',
   '.map':   'application/json',
   '.ppm':   'image/x-portable-pixmap',
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
   const ip = req.socket.remoteAddress || '-';
   const sid = req.headers['x-session-id'] || '-';
   console.log(
      `${timestamp()} ${ip} [${GIT_COMMIT} cli:${sid}] "${req.method} ${req.url}" ${status} ${size}`
   );
}

/* ------------------------------------------------------------------ */
/* File API helpers                                                    */
/* ------------------------------------------------------------------ */

const MAX_SINGLE = 10 * 1024 * 1024;  /* 10 MB single file */
const MAX_BULK   = 50 * 1024 * 1024;  /* 50 MB bulk sync */

/** Resolve a relative path safely within baseDir. Returns null if invalid. */
function safePath(relPath, baseDir) {
   if (!relPath || typeof relPath !== 'string') return null;
   if (relPath.indexOf('\0') !== -1) return null;
   const resolved = path.resolve(baseDir, relPath);
   if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) return null;
   return resolved;
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

/** Validate UUIDv4 format (prevents path traversal via session ID). */
function isValidSessionId(sid) {
   return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid);
}

/** Recursively copy a directory. */
function copyDirSync(src, dest) {
   const entries = fs.readdirSync(src, { withFileTypes: true });
   for (const entry of entries) {
      const srcPath  = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
         fs.mkdirSync(destPath, { recursive: true });
         copyDirSync(srcPath, destPath);
      } else {
         fs.copyFileSync(srcPath, destPath);
      }
   }
}

/** Format a date as yyyy-mm-ddTHHmmSS.SSS (filesystem-safe ISO-ish). */
function sessionTimestamp(d) {
   const p = (n, w) => String(n).padStart(w, '0');
   return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1,2)}-${p(d.getUTCDate(),2)}`
      + `T${p(d.getUTCHours(),2)}${p(d.getUTCMinutes(),2)}${p(d.getUTCSeconds(),2)}`
      + `.${p(d.getUTCMilliseconds(),3)}`;
}

/** Find existing session directory under SESSION_DIR/<datetime>/<sessionId>/. */
function findSessionDir(sessionId) {
   try {
      const timeDirs = fs.readdirSync(SESSION_DIR, { withFileTypes: true });
      for (const d of timeDirs) {
         if (!d.isDirectory()) continue;
         const candidate = path.join(SESSION_DIR, d.name, sessionId, 'InOut');
         if (fs.existsSync(candidate)) return candidate;
      }
   } catch (e) { /* ignore */ }
   return null;
}

/** Validate session timestamp format (yyyy-mm-ddTHHmmSS.SSS). */
function isValidSessionTs(ts) {
   return /^\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}$/.test(ts);
}

/** Get (or create) the per-session InOut directory. Auto-populates with defaults. */
function getSessionInOutDir(sessionId, clientTs) {
   const existing = findSessionDir(sessionId);
   if (existing) return existing;

   const ts = (clientTs && isValidSessionTs(clientTs)) ? clientTs : sessionTimestamp(new Date());
   const sessionInOut = path.join(SESSION_DIR, ts, sessionId, 'InOut');
   fs.mkdirSync(sessionInOut, { recursive: true });
   if (fs.existsSync(DEFAULTS_DIR)) {
      copyDirSync(DEFAULTS_DIR, sessionInOut);
      console.log(`${timestamp()} Created session ${ts}/${sessionId} with defaults`);
   } else {
      console.log(`${timestamp()} Created session ${ts}/${sessionId} (no defaults available)`);
   }
   return sessionInOut;
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
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
   /* CORS headers */
   res.setHeader('Access-Control-Allow-Origin', '*');
   res.setHeader('Access-Control-Allow-Headers', 'X-Session-ID, X-Session-TS, Content-Type');
   res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

   if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
   }

   let urlPath = decodeURIComponent(req.url.split('?')[0]);
   const urlParams = new URL(req.url, `http://localhost:${PORT}`).searchParams;

   /* ============================================================== */
   /* File API endpoints (/api/files/*)                               */
   /* ============================================================== */

   if (urlPath.startsWith('/api/files/')) {
      const sessionId = req.headers['x-session-id'] || '';

      /* GET /api/files/status — does not require valid session */
      if (urlPath === '/api/files/status' && req.method === 'GET') {
         const size = sendJSON(res, 200, {
            available: serverSyncAvailable,
            sessionId: sessionId || null,
            sessionDir: SESSION_DIR,
         });
         logReq(req, 200, size);
         return;
      }

      /* GET /api/files/raw/<path> — serve World/ and Model/ as binary (no session required) */
      if (urlPath.startsWith('/api/files/raw/') && req.method === 'GET') {
         const relPath = urlPath.slice('/api/files/raw/'.length);
         const top = relPath.split('/')[0];
         const RAW_ROOTS = { World: WORLD_DIR, Model: MODEL_DIR };
         const baseDir = RAW_ROOTS[top];
         if (!baseDir) {
            const size = sendJSON(res, 400, { error: 'Invalid path' });
            logReq(req, 400, size);
            return;
         }
         const subPath = relPath.slice(top.length + 1);
         const filePath = safePath(subPath, baseDir);
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

      /* All other endpoints require sync + valid session ID */
      if (!serverSyncAvailable) {
         const size = sendJSON(res, 503, { error: 'File sync unavailable' });
         logReq(req, 503, size);
         return;
      }
      if (!isValidSessionId(sessionId)) {
         const size = sendJSON(res, 400, { error: 'Missing or invalid X-Session-ID header' });
         logReq(req, 400, size);
         return;
      }

      const sessionTs = req.headers['x-session-ts'] || '';
      const inoutDir = getSessionInOutDir(sessionId, sessionTs);

      /* GET /api/files/list?dir=<relative-path> */
      if (urlPath === '/api/files/list' && req.method === 'GET') {
         const relDir = urlParams.get('dir') || '';
         const dirPath = safePath(relDir || '.', inoutDir);
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
         const filePath = safePath(relPath, inoutDir);
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
            const filePath = safePath(relPath, inoutDir);
            if (!filePath) {
               const size = sendJSON(res, 400, { error: 'Invalid path' });
               logReq(req, 400, size);
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

      /* POST /api/files/sync — { files: [{ path, content }] } */
      if (urlPath === '/api/files/sync' && req.method === 'POST') {
         try {
            const raw = await readBody(req, MAX_BULK);
            const { files } = JSON.parse(raw);
            if (!Array.isArray(files)) {
               const size = sendJSON(res, 400, { error: 'files must be an array' });
               logReq(req, 400, size);
               return;
            }
            const written = [];
            const errors = [];
            for (const f of files) {
               const filePath = safePath(f.path, inoutDir);
               if (!filePath) {
                  errors.push({ path: f.path, error: 'Invalid path' });
                  continue;
               }
               try {
                  fs.mkdirSync(path.dirname(filePath), { recursive: true });
                  fs.writeFileSync(filePath, f.content, 'utf8');
                  written.push(f.path);
               } catch (e) {
                  errors.push({ path: f.path, error: e.message });
               }
            }
            const size = sendJSON(res, 200, { success: errors.length === 0, written, errors });
            logReq(req, 200, size);
         } catch (e) {
            const code = e.message === 'Payload too large' ? 413 : 500;
            const size = sendJSON(res, code, { error: e.message });
            logReq(req, code, size);
         }
         return;
      }

      /* Unknown API endpoint */
      const size = sendJSON(res, 404, { error: 'Unknown API endpoint' });
      logReq(req, 404, size);
      return;
   }

   /* ============================================================== */
   /* /api/mode — backend mode detection                              */
   /* ============================================================== */

   if (urlPath === '/api/mode') {
      const size = sendJSON(res, 200, { mode: 'wasm' });
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

   /* Redirect / to /ui/ so relative asset paths resolve correctly */
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
      const headers = {
         'Content-Type': mime,
         'Content-Length': stat.size,
      };

      /* WASM and .data files: allow caching; everything else: no-store */
      if (mime === 'application/wasm' || mime === 'application/octet-stream') {
         headers['Cache-Control'] = 'public, max-age=3600';
      } else {
         headers['Cache-Control'] = 'no-store';
      }

      res.writeHead(200, headers);
      const stream = fs.createReadStream(filePath);
      stream.pipe(res);
      logReq(req, 200, stat.size);
   });
});

server.listen(PORT, () => {
   console.log(`${timestamp()} 42-web server listening on http://0.0.0.0:${PORT}`);
   console.log(`${timestamp()} Serving: ${ROOT_DIR}`);
   console.log(`${timestamp()} Git commit: ${GIT_COMMIT}`);
   console.log(`${timestamp()} Session dir: ${SESSION_DIR} (sync ${serverSyncAvailable ? 'available' : 'unavailable'})`);
   console.log(`${timestamp()} Defaults dir: ${DEFAULTS_DIR} (${fs.existsSync(DEFAULTS_DIR) ? 'found' : 'not found'})`);
});
