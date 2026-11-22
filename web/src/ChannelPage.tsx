import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ChannelVideoList } from '../../server/channel-videos';
import { channelRows, formatMinutes, type KindFilter, type SortKey } from './channelRows';

// The Channel tab: every video on the YouTube channel with its lifetime numbers. Read-only for now.
// The list is a saved copy; Refresh asks YouTube again.
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'publishedAt', label: 'Published' },
  { key: 'views', label: 'Views' },
  { key: 'minutesWatched', label: 'Watch Time' },
  { key: 'averageViewPercentage', label: 'Avg % Viewed' },
  { key: 'likes', label: 'Likes' },
  { key: 'subscribersGained', label: 'Subs Gained' },
];

export function ChannelPage() {
  const [data, setData] = useState<ChannelVideoList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [text, setText] = useState('');
  const [key, setKey] = useState<SortKey>('publishedAt');
  const [descending, setDescending] = useState(true);

  useEffect(() => { getJson<ChannelVideoList | null>('/api/channel/videos').then(setData, (e: Error) => setError(e.message)); }, []);

  const refresh = async () => {
    setBusy(true); setError(null);
    try { setData(await postJson<ChannelVideoList>('/api/channel/videos/refresh')); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const sortBy = (next: SortKey) => {
    if (next === key) setDescending(!descending);
    else { setKey(next); setDescending(next !== 'title'); }
  };

  const rows = data ? channelRows(data.videos, kind, text, key, descending) : [];
  const count = (k: 'longform' | 'short') => data?.videos.filter((v) => v.kind === k).length ?? 0;

  return (
    <div className="content wide">
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
            Lifetime numbers; “–” means YouTube has none yet. Kinds marked “?” are guessed from length.
          </p>
          <div className="idea-filters">
            <label>Kind
              <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
                <option value="all">All Videos</option>
                <option value="longform">Longform</option>
                <option value="short">Shorts</option>
              </select>
            </label>
            <label className="idea-filter-text">Title
              <input type="search" value={text} placeholder="Search titles" onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          <table className="channel-table">
            <thead>
              <tr>
                <th>Kind</th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={c.key === 'title' ? '' : 'num'}>
                    <button type="button" className="link" onClick={() => sortBy(c.key)}>{c.label}{c.key === key ? (descending ? ' ▼' : ' ▲') : ''}</button>
                  </th>
                ))}
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
                  <td className="muted">{v.piece ?? 'Not Linked'}</td>
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
