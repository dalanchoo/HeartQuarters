import type { VideoOverview } from '../../server/video-overview';

/** Search saved names and titles without requiring a YouTube request. */
export function matchesVideoSearch(item: VideoOverview, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return !query || [item.projectId, item.name, ...(item.titles ?? [])].some(value => value.toLocaleLowerCase().includes(query));
}

export function matchesProjectSearch(id: string, title: string, search: string): boolean {
  const query = search.trim().toLocaleLowerCase();
  return !query || id.toLocaleLowerCase().includes(query) || title.toLocaleLowerCase().includes(query);
}
