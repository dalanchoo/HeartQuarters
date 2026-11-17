import fs from 'node:fs';
import path from 'node:path';

/** A watcher launch has a stable session ID even when its child process restarts. */
export function shouldOpenBrowser(open: boolean, dataDir: string, session: string | undefined, parentPid: number): boolean {
  if (!open) return false;
  if (session && /^[a-f0-9-]{36}$/i.test(session)) {
    fs.mkdirSync(dataDir, { recursive: true });
    try { fs.writeFileSync(path.join(dataDir, `browser-opened-${session}.txt`), '', { flag: 'wx' }); return true; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e; }
  }
  // Support manual launches that do not use HeartQuarters' watcher wrapper.
  const marker = path.join(dataDir, 'browser-opened-by.txt'); const watcher = String(parentPid);
  try { if (fs.readFileSync(marker, 'utf8') === watcher) return false; } catch { /* first launch */ }
  fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(marker, watcher); return true;
}
