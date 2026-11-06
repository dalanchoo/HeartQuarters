// The HeartQuarters engine: a small web server on this PC only (127.0.0.1).
// The screens (web/) talk to it through the /api routes below.
import express, { type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, config, parseRoot, safeResolve } from './config.js';
import { listProjects, readProject } from './projects.js';
import { getJob, listTools, runTool } from './tools.js';

const app = express();
app.use(express.json());

/** Runs a route handler and turns any error into a readable JSON message. */
function handle(fn: (req: Request, res: Response) => void) {
  return (req: Request, res: Response) => {
    try {
      fn(req, res);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
    }
  };
}

// ---- Projects -------------------------------------------------------------

app.get('/api/projects', handle((_req, res) => {
  res.json(listProjects());
}));

app.get('/api/projects/:id', handle((req, res) => {
  res.json(readProject(String(req.params.id)));
}));

// ---- Files ----------------------------------------------------------------

// Sends any file inside the allowed folders (images, videos, text).
// Videos support seeking because Express handles "Range" requests.
app.get('/api/file', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
  });
}));

app.get('/api/text', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  if (fs.statSync(full).size > 2_000_000) throw new Error('File too large to show as text.');
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(full, 'utf8'));
}));

// Opens a folder in File Explorer (for a file, opens the folder it's in).
app.post('/api/open', handle((req, res) => {
  const full = safeResolve(parseRoot(req.body?.root), String(req.body?.path ?? ''));
  const folder = fs.statSync(full).isDirectory() ? full : path.dirname(full);
  spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// ---- Guides ---------------------------------------------------------------

app.get('/api/guides', handle((_req, res) => {
  res.json(
    config.guides.map((g) => ({ ...g, found: fs.existsSync(safeResolve(g.root, g.path)) })),
  );
}));

// ---- Tools ----------------------------------------------------------------

app.get('/api/tools', handle((_req, res) => {
  res.json(listTools());
}));

app.post('/api/tools/:id/run', handle((req, res) => {
  res.json(runTool(String(req.params.id)));
}));

app.get('/api/jobs/:id', handle((req, res) => {
  const job = getJob(String(req.params.id));
  if (!job) throw new Error('No such job.');
  res.json(job);
}));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

// ---- Screens (built by `npm run build`) -----------------------------------

const webDir = path.join(appDir, 'dist', 'web');
if (fs.existsSync(webDir)) {
  app.use(express.static(webDir));
  app.use((_req, res) => res.sendFile(path.join(webDir, 'index.html')));
}

const url = `http://127.0.0.1:${config.port}`;
app.listen(config.port, '127.0.0.1', () => {
  console.log(`HeartQuarters is running at ${url}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  if (process.argv.includes('--open')) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
