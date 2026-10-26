import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RenodeCommand } from '../src/workbench-contracts.js';
import { CompileError } from './compiler.js';
import { createRenodeSession, ownedRenodeSession } from './renode/session.js';

async function readJson(request: IncomingMessage) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) throw new CompileError('Content-Type must be application/json', 415);
  const declared = Number(request.headers['content-length']);
  if (declared > 4096) { request.resume(); throw new CompileError('Renode request exceeds 4 KiB', 413); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 4096) { request.resume(); throw new CompileError('Renode request exceeds 4 KiB', 413); }
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    return value as Record<string, unknown>;
  } catch { throw new CompileError('Renode request must be a JSON object', 400); }
}

function send(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

function parseCommand(value: unknown): RenodeCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CompileError('command must be a typed control object', 400);
  const command = value as Record<string, unknown>;
  if (command.type === 'button' && typeof command.pressed === 'boolean' && Object.keys(command).every(key => key === 'type' || key === 'pressed')) return { type: 'button', pressed: command.pressed };
  if ((command.type === 'run' || command.type === 'pause' || command.type === 'reset' || command.type === 'step') && Object.keys(command).length === 1) return { type: command.type };
  throw new CompileError('Unknown Renode control; arbitrary monitor commands are not accepted', 400);
}

export async function handleRenodeRequest(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/renode/')) return false;
  try {
    if (url.pathname === '/api/renode/sessions' && request.method === 'POST') {
      const input = await readJson(request);
      if (typeof input.buildId !== 'string' || !/^[a-f0-9]{48}$/.test(input.buildId) || Object.keys(input).length !== 1) throw new CompileError('A server-generated buildId is required', 400);
      const session = await createRenodeSession(input.buildId);
      send(response, 201, { sessionId: session.id, token: session.token, state: session.state });
      return true;
    }
    const match = /^\/api\/renode\/sessions\/([a-f0-9]{48})(?:\/(events|command|registers))?$/.exec(url.pathname);
    if (!match) throw new CompileError('Renode route not found', 404);
    const [, id, action] = match;
    if (action === 'command' && request.method === 'POST') {
      const input = await readJson(request);
      if (typeof input.token !== 'string' || Object.keys(input).some(key => key !== 'token' && key !== 'command')) throw new CompileError('Session token is required', 400);
      const session = ownedRenodeSession(id, input.token);
      await session.control(parseCommand(input.command));
      send(response, 200, { ok: true });
    } else {
      const session = ownedRenodeSession(id, url.searchParams.get('token') ?? '');
      if (action === 'events' && request.method === 'GET') session.subscribe(response);
      else if (action === 'registers' && request.method === 'GET') send(response, 200, await session.registers());
      else if (!action && request.method === 'DELETE') { await session.dispose(); send(response, 200, { ok: true }); }
      else throw new CompileError('Renode method not allowed', 405);
    }
  } catch (error) {
    if (!response.headersSent) send(response, error instanceof CompileError ? error.status : 500, { error: error instanceof Error ? error.message : 'Renode request failed' });
    else response.end();
  }
  return true;
}
