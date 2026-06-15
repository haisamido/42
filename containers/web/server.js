/*    server.js — Static file server for 42 WASM Web UI                  */
/*    Serves WASM artifacts and UI files with proper MIME types.         */
/*    Modeled after gmat-ui/web/server.js.                               */

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = parseInt(process.env.PORT || '8042', 10);
const ROOT_DIR = process.env.ROOT_DIR || path.join(__dirname);

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

const server = http.createServer((req, res) => {
   /* CORS headers */
   res.setHeader('Access-Control-Allow-Origin', '*');
   res.setHeader('Access-Control-Allow-Headers', 'X-Session-ID');

   if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
   }

   /* /version endpoint */
   let urlPath = decodeURIComponent(req.url.split('?')[0]);
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
});
