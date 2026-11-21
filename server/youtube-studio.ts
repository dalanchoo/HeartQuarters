import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Only YouTube Studio destinations are accepted; callers cannot supply a URL. */
export function studioUrl(videoId: unknown): string {
  if (videoId === undefined || videoId === null || videoId === '') return 'https://studio.youtube.com/';
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

export function edgePath(env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): string {
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((root): root is string => !!root);
  const executable = roots.map((root) => path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find(exists);
  if (!executable) throw new Error('Edge could not be found. Open YouTube Studio in Edge yourself.');
  return executable;
}

export function studioArgs(videoId: unknown, env: NodeJS.ProcessEnv = process.env): string[] {
  const profile = path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'HeartQuarters', 'YouTube Studio Edge');
  return [`--user-data-dir=${profile}`, studioUrl(videoId)];
}

export function openYouTubeStudio(videoId: unknown): Promise<void> {
  const args = studioArgs(videoId);
  const executable = edgePath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('Edge could not be opened. Please open YouTube Studio in Edge yourself.')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
