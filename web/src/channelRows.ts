import type { ChannelVideo } from '../../server/channel-videos';
import type { Angle, Topic } from '../../server/video-profile';

/** The name John knows a video by: its folder in Video Projects ("022 - Worth Telling Them", "021_S06 - I Felt Irresponsible"), or the YouTube title when it has no folder. */
export function rowName(v: Pick<ChannelVideo, 'piece' | 'title'>): string {
  if (!v.piece) return v.title;
  const parts = v.piece.split('/');
  if (parts.at(-1) === 'Longform') parts.pop();
  return parts.at(-1) ?? v.title;
}

export type SortKey = 'publishedAt' | 'title' | 'views' | 'minutesWatched' | 'averageViewPercentage' | 'likes' | 'subscribersGained';
export type KindFilter = 'all' | 'longform' | 'short';

export interface RowFilters { kind: KindFilter; topic: 'all' | Topic; angle: 'all' | Angle; text: string; unconfirmedOnly?: boolean }

/** Filter by kind, topic, angle and text (folder name, YouTube title or note), then sort. Videos without numbers always go last when sorting by a number. */
export function channelRows(videos: ChannelVideo[], filters: RowFilters, key: SortKey, descending: boolean): ChannelVideo[] {
  const needle = filters.text.trim().toLocaleLowerCase();
  const shown = videos.filter((v) => (filters.kind === 'all' || v.kind === filters.kind) && (filters.topic === 'all' || v.topic === filters.topic) && (filters.angle === 'all' || v.angle === filters.angle) && (!filters.unconfirmedOnly || v.suggested)
    && (!needle || `${rowName(v)} ${v.title} ${v.note}`.toLocaleLowerCase().includes(needle)));
  const sign = descending ? -1 : 1;
  return [...shown].sort((a, b) => {
    if (key === 'publishedAt') return sign * a.publishedAt.localeCompare(b.publishedAt);
    if (key === 'title') return sign * rowName(a).localeCompare(rowName(b));
    const x = a.numbers?.[key]; const y = b.numbers?.[key];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return sign * (x - y);
  });
}

export function formatMinutes(minutes: number): string {
  return minutes >= 60 ? `${(minutes / 60).toFixed(1)} h` : `${Math.round(minutes)} min`;
}

/**
 * The address of a video's card in Video Projects (the same addresses the Video Projects tab itself uses):
 * a longform opens its project, a Short opens its project with that Short focused, a standalone Short is its own project.
 */
export function videoProjectsHash(piece: string): string {
  const enc = encodeURIComponent;
  if (piece.endsWith('/Longform')) return `#Videos/${enc(piece.slice(0, -'/Longform'.length))}`;
  const shorts = piece.indexOf('/Shorts/');
  if (shorts >= 0) return `#Videos/${enc(piece.slice(0, shorts))}/${enc(piece)}`;
  return `#Videos/${enc(piece)}`;
}
