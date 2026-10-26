import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { compile, compilerHealth, CompileError, ROOT } from './compiler.js';
import { buildProject, getBuiltProject, getProfiles } from './projects.js';
import { handleRenodeRequest } from './renode-api.js';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 to 65535');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', `http://127.0.0.1:${port}`, `http://localhost:${port}`]);
const MAX_BODY_BYTES = 128 * 1024;
const dist = path.join(ROOT, 'dist');

function json(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw new CompileError('Request body exceeds the 128 KiB limit', 413);
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const chunks: Buffer[] = [];
  let bytes = 0;
  let settled = false;
  const timer = setTimeout(() => fail(new CompileError('Request body timed out', 408)), 5000);
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    chunks.length = 0;
    request.resume();
    reject(error);
  };
  request.on('data', (chunk: Buffer) => {
    if (settled) return;
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) { fail(new CompileError('Request body exceeds the 128 KiB limit', 413)); return; }
    chunks.push(chunk);
  });
  request.once('error', fail);
  request.once('aborted', () => fail(new CompileError('Request was aborted', 400)));
  request.once('end', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch { reject(new CompileError('Request body must be valid JSON', 400)); }
  });
  return promise;
}

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (!hosts.has(request.headers.host ?? '')) { json(response, 403, { error: 'Only the localhost workbench may access this server' }); return; }
  const origin = request.headers.origin;
  if ((origin && !origins.has(origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
    json(response, 403, { error: 'This origin is not permitted to access the local compiler' }); return;
  }
  if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
  if (request.method === 'OPTIONS') {
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.writeHead(204); response.end(); return;
  }
  try {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/api/health' && request.method === 'GET') { json(response, 200, await compilerHealth()); return; }
    if (await handleRenodeRequest(request, response, url)) return;
    if (url.pathname === '/api/projects' && request.method === 'GET') {
      json(response, 200, await getProfiles()); return;
    }
    if (url.pathname === '/api/projects/build' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new CompileError('Use Content-Type: application/json', 415);
      json(response, 200, await buildProject(await readBody(request))); return;
    }
    const artifact = /^\/api\/projects\/builds\/([A-Za-z0-9_-]{8,128})\/elf$/.exec(url.pathname);
    if (artifact && request.method === 'GET') {
      const build = await getBuiltProject(artifact[1]);
      const info = await stat(build.elfPath);
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Content-Disposition': `attachment; filename="${build.profile}.elf"`, 'Cache-Control': 'no-store' });
      createReadStream(build.elfPath).on('error', () => response.destroy()).pipe(response); return;
    }
    if (url.pathname === '/api/compile' && request.method === 'POST') {
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new CompileError('Use Content-Type: application/json', 415);
      const payload = await readBody(request);
      if (!payload || typeof payload !== 'object' || !('source' in payload)) throw new CompileError('JSON body must contain source', 400);
      json(response, 200, await compile(payload.source)); return;
    }
    if (url.pathname.startsWith('/api/')) { json(response, 404, { error: 'API endpoint not found' }); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') { json(response, 405, { error: 'Method not allowed' }); return; }
    const decoded = decodeURIComponent(url.pathname);
    let file = path.resolve(dist, `.${decoded}`);
    if (file !== dist && !file.startsWith(dist + path.sep)) { json(response, 403, { error: 'Path not allowed' }); return; }
    try { if (!(await stat(file)).isFile()) file = path.join(dist, 'index.html'); }
    catch { file = path.join(dist, 'index.html'); }
    let info;
    try { info = await stat(file); } catch { json(response, 404, { error: 'Frontend is not built. Use npm run dev, or npm run build before npm start.' }); return; }
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    if (response.headersSent || response.destroyed) return;
    if (error instanceof CompileError) json(response, error.status, { error: error.message, ...(error.diagnostics ? { diagnostics: error.diagnostics } : {}) });
    else json(response, 500, { error: error instanceof Error ? error.message : 'Internal server error' });
  }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 100;
server.listen(port, '127.0.0.1', () => console.log(`Firmware compiler listening at http://127.0.0.1:${port}`));
