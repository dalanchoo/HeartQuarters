import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { slowRequestLogger } from './slow-watch';

function run(limitMs: number, waitMs: number): string[] {
  const lines: string[] = [];
  const res = new EventEmitter();
  const realNow = Date.now; let now = 1_000;
  Date.now = () => now;
  try {
    slowRequestLogger(l => lines.push(l), limitMs)({ method: 'GET', originalUrl: '/api/expressions?x=1' } as Request, res as unknown as Response, () => undefined);
    now += waitMs; res.emit('finish');
  } finally { Date.now = realNow; }
  return lines;
}

describe('slowRequestLogger', () => {
  it('names a request that took longer than the limit, without its query', () => {
    expect(run(1000, 2500)).toEqual(['[slow] GET /api/expressions took 2.5 s']);
  });
  it('stays quiet for a quick request', () => {
    expect(run(1000, 200)).toEqual([]);
  });
});
