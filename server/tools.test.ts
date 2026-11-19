import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const spawned: Array<{ stdout: PassThrough; stderr: PassThrough; emitter: EventEmitter }> = [];
vi.mock('node:child_process', () => ({
  spawn: () => {
    const emitter = new EventEmitter();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    spawned.push({ stdout, stderr, emitter });
    return Object.assign(emitter, { stdout, stderr });
  },
}));

import { config } from './config';
import { getJob, listTools, runTool } from './tools';

const savedTools = config.tools;
afterEach(() => {
  config.tools = savedTools;
  spawned.length = 0;
});

describe('tools runner', () => {
  it('preserves multi-byte UTF-8 characters split across stdout chunks and deduplicates concurrent runs', () => {
    config.tools = [{ id: 't1', name: 'Test Tool', description: 'desc', script: 'test.py' }];
    const first = runTool('t1');
    expect(runTool('t1').id).toBe(first.id); // already running
    expect(spawned).toHaveLength(1);

    // En-dash "–" is UTF-8 bytes E2 80 93; split it across two chunks.
    spawned[0].stdout.write(Buffer.from([0x61, 0x20, 0xe2, 0x80]));
    spawned[0].stdout.write(Buffer.from([0x93, 0x20, 0x62]));
    spawned[0].emitter.emit('close', 0);

    expect(getJob(first.id)).toMatchObject({ status: 'done', exitCode: 0, output: 'a – b' });
    expect(listTools()[0].lastJob?.id).toBe(first.id);
  });

  it('rejects unknown tools and marks spawn errors as failed', () => {
    expect(() => runTool('no-such-tool')).toThrow(/Unknown tool/);
    config.tools = [{ id: 't2', name: 'Broken', description: 'desc', script: 'x.py' }];
    const job = runTool('t2');
    spawned[0].emitter.emit('error', new Error('ENOENT'));
    expect(getJob(job.id)?.status).toBe('failed');
    expect(getJob(job.id)?.output).toContain('ENOENT');
  });
});
