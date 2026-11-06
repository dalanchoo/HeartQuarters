// Small helpers for talking to the HeartQuarters server.
import type { RootId } from '../../server/config';

export type { ProjectSummary, ProjectDetail, Piece, FileRef } from '../../server/projects';
export type { Job } from '../../server/tools';
export type { RootId };

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export async function postJson<T>(url: string, data: unknown = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body as T;
}

export async function getText(root: RootId, path: string): Promise<string> {
  const res = await fetch(`/api/text?root=${root}&path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
  return res.text();
}

export function fileUrl(root: RootId, path: string): string {
  return `/api/file?root=${root}&path=${encodeURIComponent(path)}`;
}

export function openInExplorer(root: RootId, path: string) {
  return postJson('/api/open', { root, path });
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
