import type { ChannelVideo } from '../../server/channel-videos';
import type { Angle, Topic } from '../../server/video-profile';

/** The name John knows a video by: its folder in Video Projects ("022 - Worth Telling Them", "021_S06 - I Felt Irresponsible"), or the YouTube title when it has no folder. */
export function rowName(v: Pick<ChannelVideo, 'piece' | 'title'>): string {
  if (!v.piece) return v.title;
  const parts = v.piece.split('/');
  if (parts.at(-1) === 'Longform') parts.pop();
  return parts.at(-1) ?? v.title;
}

export function longformLabel(piece: string): string {
  const name = rowName({ piece, title: piece });
  return `# ${name.replace(/^(\d+[A-Z]?)\s+[-–]\s+/i, '$1-')}`;
}

export type SortKey = 'publishedAt' | 'title' | 'views' | 'searchViews' | 'browseViews' | 'minutesWatched' | 'averageViewPercentage' | 'likes' | 'subscribersGained';
export type KindFilter = 'all' | 'longform' | 'short' | 'standalone';

function isStandaloneShort(video: ChannelVideo): boolean {
  return video.kind === 'short' && video.fromLongform === 'standalone';
}

export function channelKindLabel(video: ChannelVideo): string {
  const label = isStandaloneShort(video) ? 'Standalone' : video.kind === 'short' ? 'Short' : 'Longform';
  return video.kindGuessed ? `${label} ?` : label;
}

export interface RowFilters { kind: KindFilter; topic: 'all' | Topic; angle: 'all' | Angle; text: string; /** Videos edited since the filters last changed stay listed so the row doesn't jump away. */ keep?: ReadonlySet<string> }

/** Filter by kind, topic, angle and text (folder name, YouTube title or note), then sort. Videos without numbers always go last when sorting by a number. */
export function channelRows(videos: ChannelVideo[], filters: RowFilters, key: SortKey, descending: boolean): ChannelVideo[] {
  const needle = filters.text.trim().toLocaleLowerCase();
  const matchesKind = (v: ChannelVideo) => filters.kind === 'standalone'
    ? isStandaloneShort(v)
    : filters.kind === 'all' || v.kind === filters.kind;
  const matches = (v: ChannelVideo) => matchesKind(v) && (filters.topic === 'all' || v.topic === filters.topic || v.topic2 === filters.topic) && (filters.angle === 'all' || v.angle === filters.angle || v.angle2 === filters.angle)
    && (!needle || `${rowName(v)} ${v.title} ${v.note}`.toLocaleLowerCase().includes(needle));
  const shown = videos.filter((v) => matches(v) || !!filters.keep?.has(v.id));
  const sign = descending ? -1 : 1;
  return [...shown].sort((a, b) => {
    if (key === 'publishedAt') return sign * a.publishedAt.localeCompare(b.publishedAt);
    if (key === 'title') return sign * rowName(a).localeCompare(rowName(b));
    const traffic = key === 'searchViews' || key === 'browseViews';
    const x = traffic ? a.traffic?.[key] : a.numbers?.[key];
    const y = traffic ? b.traffic?.[key] : b.numbers?.[key];
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
