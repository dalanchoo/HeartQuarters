import type { ReactNode } from 'react';
import { ANGLE_LABELS, TOPIC_LABELS } from './videoProfile';
import { channelRows, rowName, type RowFilters } from './channelRows';
import type { ChannelVideo } from '../../server/channel-videos';

export type VideoFacets = Pick<RowFilters, 'kind' | 'topic' | 'angle'>;
export type VideoSearchFilters = Pick<RowFilters, 'kind' | 'topic' | 'angle' | 'text'>;

export const ALL_VIDEO_FACETS: VideoFacets = { kind: 'all', topic: 'all', angle: 'all' };
export const ALL_VIDEO_FILTERS: VideoSearchFilters = { ...ALL_VIDEO_FACETS, text: '' };

/** Reusable sidebar with Find a Video filters and a newest-first list of matching videos. */
export function VideoSidebar({
  videos,
  selectedId,
  filters,
  onFiltersChange,
  videoHref,
  allItem,
  counts,
}: {
  videos?: ChannelVideo[];
  selectedId?: string;
  filters: VideoSearchFilters;
  onFiltersChange: (filters: VideoSearchFilters) => void;
  videoHref: (videoId: string) => string;
  allItem?: { label: string; href: string; active: boolean };
  counts?: ReadonlyMap<string, number>;
}) {
  const catalog = videos ?? [];
  const matching = channelRows(catalog, filters, 'publishedAt', true);
  const filtering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!filters.text;
  return (
    <aside aria-label="Video Browser" className="channel-video-sidebar">
      <VideoFilterBar filters={filters} onChange={onFiltersChange} />
      <p className="muted small-text" role="status">
        {videos ? `${matching.length} ${filtering ? 'Matching ' : ''}${matching.length === 1 ? 'Video' : 'Videos'}` : 'Use Refresh YouTube Data to load the video list.'}
      </p>
      <nav aria-label="Matching Videos" className="channel-video-list">
        {allItem && (
          <a
            className={`project-link${allItem.active ? ' active' : ''}`}
            href={allItem.href}
            aria-current={allItem.active ? 'page' : undefined}
          >
            {allItem.label}
          </a>
        )}
        {matching.map((video) => {
          const count = counts?.get(video.id);
          return (
            <a
              className={`project-link${video.id === selectedId ? ' active' : ''}`}
              key={video.id}
              href={videoHref(video.id)}
              aria-current={video.id === selectedId ? 'page' : undefined}
              title={video.title}
            >
              {rowName(video)}{count !== undefined ? ` (${count})` : ''}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

/** Kind, Topic, and Angle dropdowns shared by Channel and Ideas. */
export function VideoFacetControls({ filters, onChange }: { filters: VideoFacets; onChange: (filters: VideoFacets) => void }) {
  return (
    <>
      <label>Kind
        <select value={filters.kind} onChange={(e) => onChange({ ...filters, kind: e.target.value as VideoFacets['kind'] })}>
          <option value="all">All Videos</option>
          <option value="longform">Longform</option>
          <option value="short">Shorts</option>
          <option value="standalone">Standalone</option>
        </select>
      </label>
      <label>Topic
        <select value={filters.topic} onChange={(e) => onChange({ ...filters, topic: e.target.value as VideoFacets['topic'] })}>
          <option value="all">All Topics</option>
          {Object.entries(TOPIC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label>Angle
        <select value={filters.angle} onChange={(e) => onChange({ ...filters, angle: e.target.value as VideoFacets['angle'] })}>
          <option value="all">All Angles</option>
          {Object.entries(ANGLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
    </>
  );
}

/** Reusable "Find a Video" search box + Kind/Topic/Angle dropdowns + Clear Filters button. */
/** `searchAction` (for example an Add button) sits to the right of the search box. */
export function VideoFilterBar({ filters, onChange, searchAction }: { filters: VideoSearchFilters; onChange: (filters: VideoSearchFilters) => void; searchAction?: ReactNode }) {
  const filtering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!filters.text;
  return (
    <>
      <label className="channel-video-search">Find a Video
        <span className="channel-video-search-row">
          <input
            type="search"
            value={filters.text}
            placeholder="Project name or YouTube title"
            onChange={(e) => onChange({ ...filters, text: e.target.value })}
          />
          {searchAction}
        </span>
      </label>
      <div className="idea-filters">
        <VideoFacetControls filters={filters} onChange={(next) => onChange({ ...next, text: filters.text })} />
        {filtering && <button type="button" className="small" onClick={() => onChange(ALL_VIDEO_FILTERS)}>Clear Filters</button>}
      </div>
    </>
  );
}
