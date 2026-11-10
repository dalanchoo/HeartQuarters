import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { appDir } from './config.js';

interface Secrets { clientId: string; clientSecret: string; refreshToken?: string; captionAccess?: boolean }
const script = path.join(appDir, 'server', 'credential-store.ps1');
function credential(action: 'read' | 'write' | 'delete', value = ''): string {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, action], { input: value, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Could not access Windows Credential Manager.');
  return result.stdout;
}
function load(): Secrets | null { const value = credential('read'); return value ? JSON.parse(value) as Secrets : null; }
function save(value: Secrets) { credential('write', JSON.stringify(value)); }
let pending: { state: string; verifier: string; redirect: string; expires: number } | null = null;

export function youtubeStatus() { const s = load(); return { configured: !!s, connected: !!s?.refreshToken, captionAccess: !!s?.refreshToken && s.captionAccess === true }; }
export function configureYoutube(clientId: unknown, clientSecret: unknown) {
  if (typeof clientId !== 'string' || !clientId.trim().endsWith('.apps.googleusercontent.com') || typeof clientSecret !== 'string' || !clientSecret.trim()) throw new Error('Enter the desktop OAuth client ID and client secret from Google Cloud.');
  save({ clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}
export function disconnectYoutube() { pending = null; credential('delete'); }
export function authorizationUrl(port: number): string {
  const s = load(); if (!s) throw new Error('Set up your Google OAuth client first.');
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const redirect = `http://127.0.0.1:${port}/api/youtube/callback`;
  pending = { state, verifier, redirect, expires: Date.now() + 10 * 60_000 };
  const q = new URLSearchParams({ client_id: s.clientId, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl', access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
async function tokenRequest(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await r.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
  if (!r.ok || !data.access_token) throw new Error(`Google sign-in failed (${data.error ?? r.status}).`);
  return data;
}
export async function finishYoutubeAuth(state: string, code: string) {
  const p = pending; pending = null;
  if (!p || Date.now() > p.expires || !state || Buffer.byteLength(state) !== Buffer.byteLength(p.state) || !timingSafeEqual(Buffer.from(state), Buffer.from(p.state)) || !code) throw new Error('The sign-in request expired or did not match. Please try again.');
  const s = load(); if (!s) throw new Error('YouTube setup was removed.');
  const result = await tokenRequest({ client_id: s.clientId, client_secret: s.clientSecret, code, code_verifier: p.verifier, redirect_uri: p.redirect, grant_type: 'authorization_code' });
  if (!result.refresh_token) throw new Error('Google did not return a refresh token. Please reconnect.');
  save({ ...s, refreshToken: result.refresh_token, captionAccess: !!result.scope?.split(' ').includes('https://www.googleapis.com/auth/youtube.force-ssl') });
}
export async function youtubeAccessToken(): Promise<string> {
  const s = load(); if (!s?.refreshToken) throw new Error('Connect YouTube first.');
  const result = await tokenRequest({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' });
  return result.access_token!;
}
