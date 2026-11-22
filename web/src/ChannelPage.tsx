import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ChannelVideo, ChannelVideoList } from '../../server/channel-videos';
import type { Angle, Topic } from '../../server/video-profile';
import { ANGLE_LABELS, TOPIC_LABELS } from './videoProfile';
import { channelRows, formatMinutes, type KindFilter, type SortKey } from './channelRows';

// The Channel tab: every video on the YouTube channel with its lifetime numbers, plus John's own Topic, Angle and note
// for each video (the same record as About This Video in Video Projects, saved in that video's Drive folder). The list is a saved copy; Refresh asks YouTube again.
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'publishedAt', label: 'Published' },
  { key: 'views', label: 'Views' },
  { key: 'minutesWatched', label: 'Watch Time' },
  { key: 'averageViewPercentage', label: 'Avg % Viewed' },
  { key: 'likes', label: 'Likes' },
  { key: 'subscribersGained', label: 'Subs Gained' },
];

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

export function ChannelPage() {
  const [data, setData] = useState<ChannelVideoList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [text, setText] = useState('');
  const [topic, setTopic] = useState<'all' | Topic>('all');
  const [angle, setAngle] = useState<'all' | Angle>('all');
  const [unconfirmedOnly, setUnconfirmedOnly] = useState(false);
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
  const saveProfile = async (video: ChannelVideo, changes: Partial<Pick<ChannelVideo, 'topic' | 'angle' | 'note'>>) => {
    setError(null);
    try {
      const saved = await postJson<Pick<ChannelVideo, 'topic' | 'angle' | 'note'>>('/api/video-profile', { piece: video.piece, topic: video.topic, angle: video.angle, note: video.note, ...changes });
      setData((d) => d && { ...d, videos: d.videos.map((v) => (v.id === video.id ? { ...v, ...saved } : v)) });
    } catch (e) { setError((e as Error).message); }
  };
  const sortBy = (next: SortKey) => {
    if (next === key) setDescending(!descending);
    else { setKey(next); setDescending(next !== 'title'); }
  };

  const rows = data ? channelRows(data.videos, { kind, topic, angle, text, unconfirmedOnly }, key, descending) : [];
  const guesses = data?.videos.filter((v) => v.suggested).length ?? 0;
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
            Lifetime numbers; “–” means YouTube has none yet. Kinds marked “?” are guessed from length. Topics and notes are saved in each video's Drive folder.
          </p>
          <div className="idea-filters">
            <label>Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
                <option value="all">All Videos</option>
                <option value="longform">Longform</option>
                <option value="short">Shorts</option>
              </select>
            </label>
            <label>Topic
              <select value={topic} onChange={(e) => setTopic(e.target.value as 'all' | Topic)}>
                <option value="all">All Topics</option>
                {Object.entries(TOPIC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label>Angle
              <select value={angle} onChange={(e) => setAngle(e.target.value as 'all' | Angle)}>
                <option value="all">All Angles</option>
                {Object.entries(ANGLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="idea-check">
              <span>Guesses</span>
              <span><input type="checkbox" checked={unconfirmedOnly} onChange={(e) => setUnconfirmedOnly(e.target.checked)} /> Needs Confirming ({guesses})</span>
            </label>
            <label className="idea-filter-text">Title or Note
              <input type="search" value={text} placeholder="Search titles and notes" onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          <table className="channel-table">
            <thead>
              <tr>
                <th>Kind</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.key === 'title' ? '' : 'num'}>
                    <button type="button" className="sort" onClick={() => sortBy(c.key)}>{c.label}{c.key === key ? (descending ? ' ▼' : ' ▲') : ''}</button>
                  </th>
                ))}
                <th>Topic</th>
                <th>Angle</th>
                <th>Note</th>
                <th></th>
                <th>Project</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.kind === 'short' ? 'Short' : 'Longform'}{v.kindGuessed ? ' ?' : ''}</td>
                  <td className="title"><a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer">{v.title}</a>{v.privacy !== 'public' && <span className="muted"> ({v.privacy})</span>}</td>
                  <td className="num">{v.publishedAt.slice(0, 10)}</td>
                  <td className="num">{v.numbers ? v.numbers.views.toLocaleString() : '–'}</td>
                  <td className="num">{v.numbers ? formatMinutes(v.numbers.minutesWatched) : '–'}</td>
                  <td className="num">{v.numbers ? `${v.numbers.averageViewPercentage.toFixed(1)}%` : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.likes.toLocaleString() : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.subscribersGained.toLocaleString() : '–'}</td>
                  <td>
                    <select className={v.suggested ? 'guess' : ''} value={v.topic} disabled={!v.piece} title={v.piece ? '' : 'Link this video in Video Projects first'} onChange={(e) => void saveProfile(v, { topic: e.target.value as Topic })}>
                      {Object.entries(TOPIC_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className={v.suggested ? 'guess' : ''} value={v.angle} disabled={!v.piece} title={v.piece ? '' : 'Link this video in Video Projects first'} onChange={(e) => void saveProfile(v, { angle: e.target.value as Angle })}>
                      {Object.entries(ANGLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                  </td>
                  <td><NoteBox video={v} save={(n) => void saveProfile(v, { note: n })} /></td>
                  <td>{v.suggested && <button type="button" className="small" title="Claude's guess: keep Topic and Angle as they are" onClick={() => void saveProfile(v, {})}>Confirm</button>}</td>
                  <td className="muted project" title={v.piece ?? ''}>{v.piece ?? 'Not Linked'}</td>
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
