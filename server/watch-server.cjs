// Start one watcher session; its ID survives every engine restart.
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const session = randomUUID();
const marker = path.join(__dirname, '..', 'data', `browser-opened-${session}.txt`);
const tsx = path.join(path.dirname(require.resolve('tsx/package.json')), 'dist', 'cli.mjs');
const child = spawn(process.execPath, [tsx, 'watch', '--clear-screen=false', '--include', 'config.json', 'server/index.ts', '--open'], {
  stdio: 'inherit', env: { ...process.env, HQ_BROWSER_SESSION: session },
});
const cleanup = () => { try { fs.unlinkSync(marker); } catch { /* already gone */ } };
child.on('error', error => { cleanup(); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { cleanup(); process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); });
