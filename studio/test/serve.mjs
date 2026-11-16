// Minimal static server for testing Studio locally: node test/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || 8137;
const types = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.csv': 'text/csv', '.js': 'text/javascript', '.json': 'application/json' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([\\/])+/, '');
  const file = join(root, path || 'Studio_V8_13.html');
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': st.size });
    createReadStream(file).pipe(res);
  } catch (e) { res.writeHead(404).end('not found'); }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}`));
