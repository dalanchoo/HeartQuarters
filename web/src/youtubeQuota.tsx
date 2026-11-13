import { useEffect, useState } from 'react';
import { getJson } from './api';
import type { YoutubeQuota } from '../../server/youtube-quota';

// YouTube's daily quota, as HeartQuarters counts it (see server/youtube-quota.ts), and what each button will cost.
// Every request to /api/youtube/ fires "hq-youtube-used" (see api.ts), so the meter updates as soon as quota is spent.

export const QUOTA_MESSAGE = 'Out of YouTube quota for today. More at midnight Pacific time.';

export function useYoutubeQuota(): YoutubeQuota | null {
  const [quota, setQuota] = useState<YoutubeQuota | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => getJson<YoutubeQuota>('/api/youtube/quota').then((q) => { if (active) setQuota(q); }, () => {});
    void load();
    const timer = setInterval(load, 60_000); // the reset at midnight, and minutes until it
    window.addEventListener('hq-youtube-used', load);
    return () => { active = false; clearInterval(timer); window.removeEventListener('hq-youtube-used', load); };
  }, []);
  return quota;
}

const n = (x: number) => x.toLocaleString('en-US');

export function untilReset(minutes: number): string {
  const h = Math.floor(minutes / 60); const m = minutes % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** "about 63 units" */
export function units(count: number): string {
  return `about ${n(count)} unit${count === 1 ? '' : 's'}`;
}

/** Shown by the Check Linked Videos button: always visible, so John knows what he has left. */
export function QuotaMeter() {
  const quota = useYoutubeQuota();
  if (!quota) return null;
  const left = Math.max(0, quota.limit - quota.used);
  return (
    <p className={`quota-meter${quota.exhausted || left === 0 ? ' quota-out' : ''}`} title="HeartQuarters counts its own YouTube requests by YouTube's published costs. YouTube itself doesn't say how much is left.">
      {quota.exhausted || left === 0
        ? <>YouTube quota used up for today.</>
        : <>YouTube quota today: {n(quota.used)} of {n(quota.limit)} units used.</>}
      {' '}More at midnight Pacific (in {untilReset(quota.minutesUntilReset)}).
      {quota.uploads > 0 && <> Uploads today: {quota.uploads} of {quota.uploadLimit}.</>}
    </p>
  );
}

/** True when a button that uses quota should be greyed out. */
export function quotaUsedUp(quota: YoutubeQuota | null): boolean {
  return !!quota && (quota.exhausted || quota.used >= quota.limit);
}

/**
 * What reading one video's settings costs: the video (1), the list of playlists (1 per 50), whether the video is in
 * each playlist (1 each) and its captions (50). Before the playlists have ever been listed, 10 is assumed.
 */
export function readVideoCost(quota: YoutubeQuota | null): number {
  const playlists = quota?.playlists ?? 10;
  return 1 + Math.max(1, Math.ceil(playlists / 50)) + playlists + 50;
}

/** The one message for a used-up quota, with how long until it starts again. */
export function quotaMessage(quota: YoutubeQuota | null): string {
  return quota ? `${QUOTA_MESSAGE.replace(/\.$/, '')}, in ${untilReset(quota.minutesUntilReset)}.` : QUOTA_MESSAGE;
}

/** YouTube's quota error, as that one message, however a request wrapped it. Other errors are left as they are. */
export function isQuotaError(message: string): boolean {
  return /quota|daily limit/i.test(message) && /YouTube/i.test(message);
}

export function plainYoutubeError(message: string, quota: YoutubeQuota | null = null): string {
  return isQuotaError(message) ? quotaMessage(quota) : message;
}
