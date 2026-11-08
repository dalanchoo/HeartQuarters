// Small helpers for talking to the HeartQuarters server.
import type { RootId } from '../../server/config';

export type {
  ProjectNode,
  ProjectDetail,
  Piece,
  PackagingVersion,
  FileRef,
} from '../../server/projects';
export type { Job } from '../../server/tools';
export type { NewKind, CreateResult } from '../../server/create';
export type { ManageInfo, ManageResult } from '../../server/manage';
export type { WritingSummary, WritingDetail } from '../../server/writing';
export type { SkillsOverview, SkillInfo, TargetInfo, LinkState } from '../../server/skills';
export type {
  ExpressionIndex,
  ExpressionCategory,
  ExpressionPhoto,
  Tag,
} from '../../server/expressions';
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
    // X-HeartQuarters proves the request comes from our own pages (see server/security.ts).
    headers: { 'Content-Type': 'application/json', 'X-HeartQuarters': '1' },
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

export function thumbUrl(root: RootId, path: string, width = 360): string {
  return `/api/thumb?root=${root}&w=${width}&path=${encodeURIComponent(path)}`;
}

export function openInExplorer(root: RootId, path: string) {
  return postJson('/api/open', { root, path });
}

/** Copies text, falling back to the older method if the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
