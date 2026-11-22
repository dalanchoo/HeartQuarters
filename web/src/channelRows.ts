import type { ChannelVideo } from '../../server/channel-videos';

export type SortKey = 'publishedAt' | 'title' | 'views' | 'minutesWatched' | 'averageViewPercentage' | 'likes' | 'subscribersGained';
export type KindFilter = 'all' | 'longform' | 'short';

/** Filter by kind and title text, then sort. Videos without numbers always go last when sorting by a number. */
export function channelRows(videos: ChannelVideo[], kind: KindFilter, text: string, key: SortKey, descending: boolean): ChannelVideo[] {
  const needle = text.trim().toLocaleLowerCase();
  const shown = videos.filter((v) => (kind === 'all' || v.kind === kind) && (!needle || v.title.toLocaleLowerCase().includes(needle)));
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
