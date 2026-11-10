import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Only YouTube Studio destinations are accepted; callers cannot supply a URL. */
export function studioUrl(videoId: unknown): string {
  if (videoId === undefined || videoId === null || videoId === '') return 'https://studio.youtube.com/';
  if (typeof videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Invalid YouTube video ID.');
  return `https://studio.youtube.com/video/${videoId}/edit`;
}

export function chromePath(env: NodeJS.ProcessEnv = process.env, exists = fs.existsSync): string {
  const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((root): root is string => !!root);
  const executable = roots.map((root) => path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')).find(exists);
  if (!executable) throw new Error('Chrome could not be found. Open YouTube Studio in Chrome yourself.');
  return executable;
}

export function openYouTubeStudio(videoId: unknown): Promise<void> {
  const url = studioUrl(videoId);
  const executable = chromePath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', () => reject(new Error('Chrome could not be opened. Please open YouTube Studio in Chrome yourself.')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
