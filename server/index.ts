// The HeartQuarters engine: a small web server on this PC only (127.0.0.1).
// The screens (web/) talk to it through the /api routes below.
import express, { type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appDir, config, parseRoot, safeResolve } from './config.js';
import { listProjects, readProject } from './projects.js';
import { getJob, listTools, runTool } from './tools.js';
import { draftHtml, listWriting, readWriting } from './writing.js';
import { expressionIndex } from './expressions.js';
import { thumbnail } from './thumbs.js';
import { guard, sandboxHeaders } from './security.js';

const app = express();
app.use(guard); // see security.ts: blocks other websites
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

// ?id= is a relative path, e.g. "005 - Ayahuasca/005B - Night One".
app.get('/api/project', handle((req, res) => {
  res.json(readProject(String(req.query.id ?? '')));
}));

// ---- Files ----------------------------------------------------------------

// Sends any file inside the allowed folders (images, videos, text).
// Videos support seeking because Express handles "Range" requests.
app.get('/api/file', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  sandboxHeaders(res);
  res.sendFile(full, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found.' });
  });
}));

app.get('/api/text', handle((req, res) => {
  const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
  if (fs.statSync(full).size > 2_000_000) throw new Error('File too large to show as text.');
  sandboxHeaders(res);
  res.type('text/plain; charset=utf-8').send(fs.readFileSync(full, 'utf8'));
}));

// Opens a folder in File Explorer (for a file, opens the folder it's in).
app.post('/api/open', handle((req, res) => {
  const full = safeResolve(parseRoot(req.body?.root), String(req.body?.path ?? ''));
  const folder = fs.statSync(full).isDirectory() ? full : path.dirname(full);
  spawn('explorer.exe', [folder], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// Small JPEG preview of an image (made once, then cached in data/thumbs).
app.get('/api/thumb', (req, res) => {
  try {
    const full = safeResolve(parseRoot(req.query.root), String(req.query.path ?? ''));
    const width = Math.min(800, Math.max(120, Number(req.query.w) || 360));
    thumbnail(full, width).then(
      (thumb) => res.set('Cache-Control', 'max-age=86400').sendFile(thumb),
      (e) => res.status(500).json({ error: e instanceof Error ? e.message : String(e) }),
    );
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---- Expressions ----------------------------------------------------------

app.get('/api/expressions', handle((_req, res) => {
  res.json(expressionIndex());
}));

// ---- Writing (Substack) ---------------------------------------------------

app.get('/api/writing', handle((_req, res) => {
  res.json(listWriting());
}));

app.get('/api/writing/piece', handle((req, res) => {
  res.json(readWriting(String(req.query.id ?? '')));
}));

app.get('/api/writing/draft', (req, res) => {
  draftHtml(String(req.query.path ?? '')).then(
    (html) => res.json({ html }),
    (e) => res.status(400).json({ error: e instanceof Error ? e.message : String(e) }),
  );
});

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

// The screens are rebuilt in the background while the app runs (npm start),
// so look for them on each request rather than once at startup.
const webDir = path.join(appDir, 'dist', 'web');
app.use(express.static(webDir));
app.use((_req, res) => {
  res.sendFile(path.join(webDir, 'index.html'), (err) => {
    if (err && !res.headersSent) res.status(503).send('The screens are still building. Refresh in a moment.');
  });
});

/**
 * With auto-reload, the engine restarts whenever its code changes. Only open
 * the browser on the first start: the watcher (our parent process) stays the
 * same across restarts, so remember which watcher already opened it.
 */
function shouldOpenBrowser(): boolean {
  if (!process.argv.includes('--open')) return false;
  const marker = path.join(appDir, 'data', 'browser-opened-by.txt');
  const watcher = String(process.ppid);
  try {
    if (fs.readFileSync(marker, 'utf8') === watcher) return false;
  } catch {
    /* first run */
  }
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, watcher);
  return true;
}

// HQ_PORT lets a second copy run alongside (e.g. for testing).
const port = Number(process.env.HQ_PORT) || config.port;
const url = `http://127.0.0.1:${port}`;
app.listen(port, '127.0.0.1', () => {
  console.log(`HeartQuarters is running at ${url}`);
  console.log('Close this window (or press Ctrl+C) to stop it.');
  if (shouldOpenBrowser()) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  }
});
