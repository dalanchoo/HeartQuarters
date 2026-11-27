import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from './config';
import { app } from './index';
import { makeTree, removeTree } from './testing';

let server: Server;
let baseUrl: string;
let root: string;
let savedProjects: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

beforeEach(() => {
  root = makeTree({ 'Projects/001 - Test/notes.txt': 'hello world' });
  savedProjects = config.videoProjectsDir;
  config.videoProjectsDir = path.join(root, 'Projects');
});

afterEach(() => {
  config.videoProjectsDir = savedProjects;
  removeTree(root);
});

describe('HTTP API routes and guard', () => {
  it('returns 404 JSON for unknown /api routes', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Unknown API route.' });
  });

  it('blocks POST without X-HeartQuarters or from a foreign origin', async () => {
    const missingHeader = await fetch(`${baseUrl}/api/chat/new`, { method: 'POST' });
    expect(missingHeader.status).toBe(403);

    const foreignOrigin = await fetch(`${baseUrl}/api/chat/new`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com', 'X-HeartQuarters': '1' },
    });
    expect(foreignOrigin.status).toBe(403);
  });

  it('serves /api/file and /api/text with sandbox headers and blocks traversal', async () => {
    const fileRes = await fetch(`${baseUrl}/api/file?root=projects&path=${encodeURIComponent('001 - Test/notes.txt')}`);
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get('content-security-policy')).toBe('sandbox');
    expect(fileRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await fileRes.text()).toBe('hello world');

    const textRes = await fetch(`${baseUrl}/api/text?root=projects&path=${encodeURIComponent('001 - Test/notes.txt')}`);
    expect(textRes.status).toBe(200);
    expect(await textRes.text()).toBe('hello world');

    const badRes = await fetch(`${baseUrl}/api/text?root=projects&path=${encodeURIComponent('../secret.txt')}`);
    expect(badRes.status).toBe(400);
  });

  it('handles raw /api/chat/upload and rejects oversized JSON bodies with 413', async () => {
    const emptyRes = await fetch(`${baseUrl}/api/chat/upload?name=note.txt`, {
      method: 'POST',
      headers: { 'X-HeartQuarters': '1', 'Content-Type': 'application/octet-stream' },
      body: Buffer.alloc(0),
    });
    expect(emptyRes.status).toBe(400);

    const okRes = await fetch(`${baseUrl}/api/chat/upload?name=note.txt`, {
      method: 'POST',
      headers: { 'X-HeartQuarters': '1', 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('uploaded text'),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ name: 'note.txt', size: 13 });

    const tooBig = await fetch(`${baseUrl}/api/chat/new`, {
      method: 'POST',
      headers: { 'X-HeartQuarters': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(200_000) }),
    });
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: 'That upload is too large.' });
  });
});
