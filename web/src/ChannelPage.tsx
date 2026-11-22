import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ChannelVideo, ChannelVideoList } from '../../server/channel-videos';
import type { Angle, Topic, VideoProfile } from '../../server/video-profile';
import { ANGLE_LABELS, TOPIC_LABELS } from './videoProfile';
import { channelKindLabel, channelRows, formatMinutes, longformLabel, rowName, videoProjectsHash, type KindFilter, type SortKey } from './channelRows';

// The Channel tab: every video on the YouTube channel with its lifetime numbers, plus John's own Topic, Angle and note
// for each video (the same record as About This Video in Video Projects, saved in that video's Drive folder). The list is a saved copy; Refresh asks YouTube again.
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Project' },
  { key: 'publishedAt', label: 'Published' },
  { key: 'views', label: 'Views' },
  { key: 'searchViews', label: 'Search Views' },
  { key: 'browseViews', label: 'Browse Views' },
  { key: 'minutesWatched', label: 'Watch Time' },
  { key: 'averageViewPercentage', label: 'Avg % Viewed' },
  { key: 'likes', label: 'Likes' },
  { key: 'subscribersGained', label: 'Subs Gained' },
];

export function ChannelTableHead({ sortKey, descending, sortBy }: { sortKey: SortKey; descending: boolean; sortBy: (key: SortKey) => void }) {
  return (
    <thead>
      <tr>
        <th>Kind</th>
        {COLUMNS.map(({ key, label }) => {
          const direction = key === sortKey ? (descending ? 'descending' : 'ascending') : undefined;
          return (
            <th key={key} className={key === 'title' ? '' : 'num'} aria-sort={direction}>
              <button type="button" className="sort" onClick={() => sortBy(key)}>
                {label}<span className="sort-icon" aria-hidden="true">{direction ? (descending ? '▼' : '▲') : '↕'}</span>
              </button>
            </th>
          );
        })}
        <th>Topic</th>
        <th>Angle</th>
      </tr>
    </thead>
  );
}

type ProfileChanges = Partial<VideoProfile>;

/** A main choice with a smaller second choice under it (the second reads "None" when empty). Both save straight away. */
function PairCell<T extends string>({ video, labels, main, second, save }: { video: ChannelVideo; labels: Record<T, string>; main: 'topic' | 'angle'; second: 'topic2' | 'angle2'; save: (changes: ProfileChanges) => void }) {
  const off = !video.piece;
  const tip = off ? 'Link this video in Video Projects first' : '';
  const choose = (field: 'topic' | 'topic2' | 'angle' | 'angle2') => (e: { target: { value: string } }) => save({ [field]: e.target.value } as ProfileChanges);
  return (
    <div className="pair">
      <select value={video[main]} disabled={off} title={tip} onChange={choose(main)}>
        {Object.entries<string>(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <select className="second" value={video[second]} disabled={off} title={tip || 'Optional second choice'} onChange={choose(second)}>
        {Object.entries<string>(labels).map(([id, label]) => <option key={id} value={id}>{id === 'unassigned' ? 'None' : label}</option>)}
      </select>
    </div>
  );
}

/** The note box for one video: saved when you leave it or press Enter. */
function NoteBox({ video, save }: { video: ChannelVideo; save: (note: string) => void }) {
  const [text, setText] = useState(video.note);
  useEffect(() => setText(video.note), [video.note]);
  return (
    <input type="text" className="channel-note" value={text} maxLength={2000} disabled={!video.piece} placeholder={video.piece ? 'Add a note' : 'Link it first'}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== video.note) save(text); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

export function ChannelProjectCell({ video, saveNote }: { video: ChannelVideo; saveNote: (note: string) => void }) {
  const name = rowName(video);
  const source = video.fromLongform;
  return (
    <td className="title">
      <div className="channel-project">
        <div>
          {video.piece ? <a href={videoProjectsHash(video.piece)} title={`Open in Video Projects. On YouTube: ${video.title}`}>{name}</a> :
            <span title="Not linked to a project folder yet">{video.title} <span className="muted">(Not Linked)</span></span>}
          {video.privacy !== 'public' && <span className="muted"> ({video.privacy})</span>}
          {' '}<a className="yt-link" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" title="Opens YouTube in a new tab. Watching there adds to this video's view count.">YouTube ↗</a>
        </div>
        {video.kind === 'short' && source !== 'standalone' && (
          <div className="channel-parent">
            {source ? <>From <a href={videoProjectsHash(source)}>{longformLabel(source)}</a></> : 'Source Unknown'}
          </div>
        )}
        <details className="channel-project-details">
          <summary aria-label={`Details for ${name}`} title="Video Details" />
          <div className="channel-project-fields">
            <label>Note <NoteBox video={video} save={saveNote} /></label>
          </div>
        </details>
      </div>
    </td>
  );
}

export function ChannelPage() {
  const [data, setData] = useState<ChannelVideoList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState<'all' | Topic>('all');
  const [angle, setAngle] = useState<'all' | Angle>('all');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [key, setKey] = useState<SortKey>('publishedAt');
  const [descending, setDescending] = useState(true);

  useEffect(() => { getJson<ChannelVideoList | null>('/api/channel/videos').then(setData, (e: Error) => setError(e.message)); }, []);

  const refresh = async () => {
    setBusy(true); setError(null);
    try { setData(await postJson<ChannelVideoList>('/api/channel/videos/refresh')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  /** Save one video's topic and note in its Drive folder, then show what the engine saved. */
  const saveProfile = async (video: ChannelVideo, changes: ProfileChanges) => {
    setError(null);
    try {
      const saved = await postJson<VideoProfile>('/api/video-profile', { piece: video.piece, topic: video.topic, topic2: video.topic2, angle: video.angle, angle2: video.angle2, note: video.note, ...changes });
      setData((d) => d && { ...d, videos: d.videos.map((v) => (v.id === video.id ? { ...v, ...saved } : v)) });
      setTouched((t) => new Set(t).add(video.id));
    } catch (e) { setError((e as Error).message); }
  };
  const sortBy = (next: SortKey) => {
    if (next === key) setDescending(!descending);
    else { setKey(next); setDescending(next !== 'title'); }
  };

  const rows = data ? channelRows(data.videos, { kind, topic, angle, text, keep: touched }, key, descending) : [];
  const count = (k: 'longform' | 'short') => data?.videos.filter((v) => v.kind === k).length ?? 0;

  return (
    <div className="content channel-page">
      <div className="page-head">
        <h1>Channel</h1>
        <button type="button" className="small" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh From YouTube'}</button>
      </div>
      {error && <p className="error">{error}</p>}
      {data === null && <p className="muted">Nothing saved yet. Press Refresh From YouTube to load your videos.</p>}
      {data && (
        <>
          <p className="muted">
            {data.channel.title}: {count('longform')} longform, {count('short')} Shorts. Updated {new Date(data.updatedAt).toLocaleString()}.
            Lifetime numbers. “–” means no count is available. Refresh to load Search and Browse Views on older lists.
            Kinds marked “?” are guessed from length. Topics and notes are saved in each video's Drive folder.
          </p>
          <div className="idea-filters">
            <label>Kind
              <select value={kind} onChange={(e) => { setKind(e.target.value as KindFilter); setTouched(new Set()); }}>
                <option value="all">All Videos</option>
                <option value="longform">Longform</option>
                <option value="short">Shorts</option>
                <option value="standalone">Standalone</option>
              </select>
            </label>
            <label>Topic
              <select value={topic} onChange={(e) => { setTopic(e.target.value as 'all' | Topic); setTouched(new Set()); }}>
                <option value="all">All Topics</option>
                {Object.entries(TOPIC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>Angle
              <select value={angle} onChange={(e) => { setAngle(e.target.value as 'all' | Angle); setTouched(new Set()); }}>
                <option value="all">All Angles</option>
                {Object.entries(ANGLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="idea-filter-text">Project, Title or Note
              <input type="search" value={text} placeholder="Search project names, YouTube titles and notes" onChange={(e) => { setText(e.target.value); setTouched(new Set()); }} />
            </label>
          </div>
          <table className="channel-table">
            <ChannelTableHead sortKey={key} descending={descending} sortBy={sortBy} />
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{channelKindLabel(v)}</td>
                  <ChannelProjectCell video={v} saveNote={(note) => void saveProfile(v, { note })} />
                  <td className="num">{v.publishedAt.slice(0, 10)}</td>
                  <td className="num">{v.numbers ? v.numbers.views.toLocaleString() : '–'}</td>
                  <td className="num">{v.traffic?.searchViews?.toLocaleString() ?? '–'}</td>
                  <td className="num">{v.traffic?.browseViews?.toLocaleString() ?? '–'}</td>
                  <td className="num">{v.numbers ? formatMinutes(v.numbers.minutesWatched) : '–'}</td>
                  <td className="num">{v.numbers ? `${v.numbers.averageViewPercentage.toFixed(1)}%` : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.likes.toLocaleString() : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.subscribersGained.toLocaleString() : '–'}</td>
                  <td><PairCell video={v} labels={TOPIC_LABELS} main="topic" second="topic2" save={(changes) => void saveProfile(v, changes)} /></td>
                  <td><PairCell video={v} labels={ANGLE_LABELS} main="angle" second="angle2" save={(changes) => void saveProfile(v, changes)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted">No videos match.</p>}
        </>
      )}
    </div>
  );
}
