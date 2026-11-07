// The guard stops other websites in your browser from using HeartQuarters.
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { guard, isLocalHost, isLocalOrigin } from './security';

function run(req: { method: string; headers: Record<string, string> }) {
  const res = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, send: vi.fn(), json: vi.fn() };
  const next = vi.fn();
  guard(req as unknown as Request, res as unknown as Response, next);
  return { allowed: next.mock.calls.length === 1, status: res.statusCode };
}

describe('isLocalHost', () => {
  it('accepts this PC', () => {
    expect(isLocalHost('127.0.0.1:4321')).toBe(true);
    expect(isLocalHost('localhost:5173')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
  });
  it('rejects other names (DNS rebinding)', () => {
    expect(isLocalHost('evil.example.com:4321')).toBe(false);
    expect(isLocalHost('127.0.0.1.evil.com')).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
  });
});

describe('isLocalOrigin', () => {
  it('accepts our own pages and requests with no origin', () => {
    expect(isLocalOrigin('http://127.0.0.1:4321')).toBe(true);
    expect(isLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isLocalOrigin(undefined)).toBe(true);
  });
  it('rejects other websites and sandboxed pages', () => {
    expect(isLocalOrigin('https://evil.example.com')).toBe(false);
    expect(isLocalOrigin('http://127.0.0.1.evil.com')).toBe(false);
    expect(isLocalOrigin('null')).toBe(false);
  });
});

describe('guard', () => {
  const host = { host: '127.0.0.1:4321' };

  it('lets the app read data', () => {
    expect(run({ method: 'GET', headers: host }).allowed).toBe(true);
  });

  it('lets the app run a tool', () => {
    const r = run({ method: 'POST', headers: { ...host, origin: 'http://127.0.0.1:4321', 'x-heartquarters': '1' } });
    expect(r.allowed).toBe(true);
  });

  it('blocks a tool run from another website', () => {
    const r = run({ method: 'POST', headers: { ...host, origin: 'https://evil.example.com', 'x-heartquarters': '1' } });
    expect(r).toEqual({ allowed: false, status: 403 });
  });

  it('blocks a tool run without the HeartQuarters header (e.g. a hidden form)', () => {
    const r = run({ method: 'POST', headers: { ...host, origin: 'http://127.0.0.1:4321' } });
    expect(r).toEqual({ allowed: false, status: 403 });
  });

  it('blocks requests addressed to another name', () => {
    expect(run({ method: 'GET', headers: { host: 'evil.example.com' } })).toEqual({ allowed: false, status: 403 });
  });
});
