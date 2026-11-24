import { ANGLE_LABELS, TOPIC_LABELS } from './videoProfile';
import type { RowFilters } from './channelRows';

export type VideoFacets = Pick<RowFilters, 'kind' | 'topic' | 'angle'>;
export type VideoSearchFilters = Pick<RowFilters, 'kind' | 'topic' | 'angle' | 'text'>;

export const ALL_VIDEO_FACETS: VideoFacets = { kind: 'all', topic: 'all', angle: 'all' };
export const ALL_VIDEO_FILTERS: VideoSearchFilters = { ...ALL_VIDEO_FACETS, text: '' };

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
export function VideoFilterBar({ filters, onChange }: { filters: VideoSearchFilters; onChange: (filters: VideoSearchFilters) => void }) {
  const filtering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!filters.text;
  return (
    <>
      <label className="channel-video-search">Find a Video
        <input
          type="search"
          value={filters.text}
          placeholder="Project name or YouTube title"
          onChange={(e) => onChange({ ...filters, text: e.target.value })}
        />
      </label>
      <div className="idea-filters">
        <VideoFacetControls filters={filters} onChange={(next) => onChange({ ...next, text: filters.text })} />
        {filtering && <button type="button" className="small" onClick={() => onChange(ALL_VIDEO_FILTERS)}>Clear Filters</button>}
      </div>
    </>
  );
}
