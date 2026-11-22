import type { ChannelVideo } from '../../server/channel-videos';
import type { Angle, Topic } from '../../server/video-profile';

export type SortKey = 'publishedAt' | 'title' | 'views' | 'minutesWatched' | 'averageViewPercentage' | 'likes' | 'subscribersGained';
export type KindFilter = 'all' | 'longform' | 'short';

export interface RowFilters { kind: KindFilter; topic: 'all' | Topic; angle: 'all' | Angle; text: string }

/** Filter by kind, topic, angle and text (title or note), then sort. Videos without numbers always go last when sorting by a number. */
export function channelRows(videos: ChannelVideo[], filters: RowFilters, key: SortKey, descending: boolean): ChannelVideo[] {
  const needle = filters.text.trim().toLocaleLowerCase();
  const shown = videos.filter((v) => (filters.kind === 'all' || v.kind === filters.kind) && (filters.topic === 'all' || v.topic === filters.topic) && (filters.angle === 'all' || v.angle === filters.angle)
    && (!needle || `${v.title} ${v.note}`.toLocaleLowerCase().includes(needle)));
  const sign = descending ? -1 : 1;
  return [...shown].sort((a, b) => {
    if (key === 'publishedAt') return sign * a.publishedAt.localeCompare(b.publishedAt);
    if (key === 'title') return sign * a.title.localeCompare(b.title);
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
