// Which caption tracks are extra copies, and sending to HeartQuarters' own track. A fake YouTube only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extraCaptionTracks, HQ_TRACK_NAME, sendSubtitle, type CaptionTrack } from './youtube-captions';

afterEach(() => vi.unstubAllGlobals());
const ours: CaptionTrack = { id: 'hq', language: 'en-US', name: HQ_TRACK_NAME, kind: 'standard' };
const studioCopy: CaptionTrack = { id: 'studio', language: 'en-US', name: '', kind: 'standard' };
const automatic: CaptionTrack = { id: 'asr', language: 'en', name: '', kind: 'asr' };

describe('extra caption tracks', () => {
  it("are other tracks in our track's language, like the copy Studio's editor makes (022_S07)", () => {
    expect(extraCaptionTracks([ours, automatic, studioCopy]).map((t) => t.id)).toEqual(['studio']);
  });
  it("leave YouTube's automatic track, other languages, and videos without our track alone", () => {
    expect(extraCaptionTracks([ours, automatic])).toEqual([]);
    expect(extraCaptionTracks([ours, { ...studioCopy, language: 'es' }])).toEqual([]);
    expect(extraCaptionTracks([{ id: 'old', language: 'en', name: 'English', kind: 'standard' }, automatic])).toEqual([]);
  });
});

describe('sending captions', () => {
  it("replaces HeartQuarters' own track even when Studio has added another", async () => {
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url), body: init?.body ? Buffer.from(init.body as Uint8Array).toString() : undefined });
      if (String(url).includes('captions?part=snippet&videoId')) {
        return Response.json({ items: [ours, studioCopy, automatic].map((t) => ({ id: t.id, snippet: { language: t.language, name: t.name, trackKind: t.kind } })) });
      }
      return Response.json({});
    }));
    expect(await sendSubtitle('token', 'video', Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHi\n'), 'en-US')).toBe('replaced');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toContain('"id":"hq"');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
