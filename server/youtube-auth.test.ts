import { afterEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({ value: '' }));
vi.mock('node:child_process', () => ({ spawnSync: (_exe: string, args: string[], options: { input: string }) => {
  const action = args.at(-1);
  if (action === 'write') store.value = options.input;
  if (action === 'delete') store.value = '';
  return { status: 0, stdout: action === 'read' ? store.value : '' };
} }));
import { authorizationUrl, configureYoutube, disconnectYoutube, finishYoutubeAuth, youtubeAccessToken, youtubeStatus } from './youtube-auth';

afterEach(() => { disconnectYoutube(); vi.unstubAllGlobals(); });
describe('YouTube sign-in', () => {
  it('uses a one-use matching state and PKCE before storing a refresh token', async () => {
    configureYoutube('123.apps.googleusercontent.com', 'secret');
    const url = new URL(authorizationUrl(4321));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4321/api/youtube/callback');
    await expect(finishYoutubeAuth('wrong', 'code')).rejects.toThrow(/match/);
    expect(youtubeStatus().connected).toBe(false);
    const next = new URL(authorizationUrl(4321));
    const mock = vi.fn().mockImplementation(async () => Response.json({ access_token: 'access', refresh_token: 'refresh' }));
    vi.stubGlobal('fetch', mock);
    await finishYoutubeAuth(next.searchParams.get('state')!, 'code');
    expect(youtubeStatus().connected).toBe(true);
    expect(String(mock.mock.calls[0][1].body)).toContain('code_verifier=');
    expect(await youtubeAccessToken()).toBe('access');
    await expect(finishYoutubeAuth(next.searchParams.get('state')!, 'code')).rejects.toThrow(/match/);
  });
  it('rejects missing configuration and bad client IDs', () => {
    expect(() => authorizationUrl(4321)).toThrow(/Set up/);
    expect(() => configureYoutube('not-a-client-id', 'secret')).toThrow(/client ID/);
  });
});
