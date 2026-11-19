// Runs the Python tools listed in config.json and keeps their output so the
// screen can show it while they run. Jobs are kept in memory only: restarting
// the app forgets them (the tools' own output files are unaffected).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface Job {
  id: string;
  toolId: string;
  status: 'running' | 'done' | 'failed';
  output: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

const MAX_OUTPUT = 200_000; // characters kept per job
const MAX_JOBS = 20;
const jobs = new Map<string, Job>();
let nextId = 1;

function pruneJobs() {
  if (jobs.size <= MAX_JOBS) return;
  for (const [id, j] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (j.status !== 'running') jobs.delete(id);
  }
}

export function listTools() {
  return config.tools.map((tool) => ({
    ...tool,
    found: fs.existsSync(path.join(config.toolsDir, tool.script)),
    lastJob: latestJobFor(tool.id) ?? null,
  }));
}

function latestJobFor(toolId: string): Job | undefined {
  return [...jobs.values()].filter((j) => j.toolId === toolId).at(-1);
}

export function runTool(toolId: string): Job {
  const tool = config.tools.find((t) => t.id === toolId);
  if (!tool) throw new Error('Unknown tool.');

  const running = latestJobFor(toolId);
  if (running?.status === 'running') return running; // don't start it twice

  const job: Job = {
    id: String(nextId++),
    toolId,
    status: 'running',
    output: '',
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  pruneJobs();

  const append = (text: string) => {
    job.output = (job.output + text).slice(-MAX_OUTPUT);
  };
  const finish = (status: Job['status'], code: number | null) => {
    if (job.finishedAt) return;
    job.status = status;
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    pruneJobs();
  };

  // Run from the tools folder so scripts can import each other
  // (UpdateContentArchive.py imports the other two).
  const child = spawn(config.python, ['-u', tool.script], {
    cwd: config.toolsDir,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8').on('data', (s: string) => append(s));
  child.stderr.setEncoding('utf8').on('data', (s: string) => append(s));
  child.on('error', (e) => {
    append(`\n[Could not start Python: ${e.message}]\n`);
    finish('failed', null);
  });
  child.on('close', (code) => finish(code === 0 ? 'done' : 'failed', code));

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
