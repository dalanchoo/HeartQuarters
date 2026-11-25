// Channel -> Research -> Outside Demand: what other channels made on a topic, from a YouTube search.
// Kept apart from "Your Channel Evidence" on purpose.
import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ResearchTopic } from '../../server/channel-research';
import type { FilteredVideo, OutsideOverview, ScanFormat, ScanReach, ScanSettings } from '../../server/outside-youtube';

const FORMATS: { id: ScanFormat; label: string }[] = [{ id: 'longform', label: 'Longform' }, { id: 'short', label: 'Shorts' }, { id: 'both', label: 'Both' }];
const REACHES: { id: ScanReach; label: string }[] = [{ id: 'english', label: 'English Only' }, { id: 'worldwide', label: 'Worldwide (Translated in Reports)' }];

type SortKey = 'views' | 'publishedAt' | 'title' | 'channelTitle' | 'seconds';
type KindFilter = 'all' | 'longform' | 'short';
type KeptFilter = 'kept' | 'removed' | 'all';

const lines = (text: string) => text.split('\n');
const tidy = (words: string[]) => words.map((w) => w.trim()).filter(Boolean);

function formatNumber(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

function formatLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Sorts a copy of the videos; numbers and dates start highest, text starts at A. */
function sortVideos(videos: FilteredVideo[], key: SortKey, descending: boolean): FilteredVideo[] {
  const value = (v: FilteredVideo) => (key === 'views' ? v.views ?? -1 : v[key]);
  return [...videos].sort((a, b) => {
    const x = value(a), y = value(b);
    const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return descending ? -order : order;
  });
}

export function OutsideDemand({ topic }: { topic: ResearchTopic }) {
  const [overview, setOverview] = useState<OutsideOverview | null>(null);
  const [draft, setDraft] = useState<ScanSettings | null>(null);
  const [words, setWords] = useState('');
  const [mentions, setMentions] = useState('');
  const [busy, setBusy] = useState<'save' | 'scan' | null>(null);
  const [showVideos, setShowVideos] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('views');
  const [descending, setDescending] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [keptFilter, setKeptFilter] = useState<KeptFilter>('kept');
  const [error, setError] = useState('');

  const show = (data: OutsideOverview) => {
    setOverview(data);
    setDraft(data.settings);
    setWords(data.settings.searchWords.join('\n'));
    setMentions(data.settings.mustMention.join('\n'));
  };

  useEffect(() => {
    getJson<OutsideOverview>(`/api/channel/research/outside?topic=${encodeURIComponent(topic)}`).then(show, (e: Error) => setError(e.message));
  }, [topic]);

  if (!overview || !draft) return error ? <p className="error" role="alert">{error}</p> : <p className="muted small-text">Loading Outside Demand…</p>;

  const pending: ScanSettings = { ...draft, searchWords: lines(words), mustMention: lines(mentions) };
  const tidied = { ...pending, searchWords: tidy(pending.searchWords), mustMention: tidy(pending.mustMention) };
  const changed = JSON.stringify(tidied) !== JSON.stringify(overview.settings);
  // Only search changes need a new scan; Must Mention just re-filters the saved one.
  const searchChanged = JSON.stringify({ ...tidied, mustMention: [], vidiq: false }) !== JSON.stringify({ ...overview.settings, mustMention: [], vidiq: false });

  const save = async () => {
    setBusy('save');
    setError('');
    try { show(await postJson<OutsideOverview>('/api/channel/research/outside/settings', { topic, settings: pending })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const scan = async () => {
    setBusy('scan');
    setError('');
    try { show(await postJson<OutsideOverview>('/api/channel/research/outside/scan', { topic })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const sortBy = (key: SortKey) => {
    if (key === sortKey) setDescending(!descending);
    else { setSortKey(key); setDescending(key === 'views' || key === 'publishedAt' || key === 'seconds'); }
  };
  const header = (key: SortKey, label: string) => (
    <th aria-sort={sortKey === key ? (descending ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="sort-button" onClick={() => sortBy(key)}>{label}{sortKey === key ? (descending ? ' ▼' : ' ▲') : ''}</button>
    </th>
  );

  const latest = overview.latest;
  const keptVideos = latest?.videos.filter((v) => v.kept) ?? [];
  const shorts = keptVideos.filter((v) => v.kind === 'short').length;
  const shown = latest ? sortVideos(latest.videos.filter((v) =>
    (kind === 'all' || v.kind === kind) && (keptFilter === 'all' || (keptFilter === 'kept') === v.kept)), sortKey, descending) : [];

  return (
    <div className="outside-demand">
      <p className="muted small-text">
        What other YouTube channels made on this topic. Kept separate from your channel evidence. Your own videos are left out.
      </p>
      <div className="outside-settings">
        <label className="outside-words">
          <span>Search Words <span className="muted small-text">(one per line, up to 8; -word leaves a word out)</span></span>
          <textarea rows={4} value={words} onChange={(e) => setWords(e.target.value)} />
        </label>
        <label className="outside-words">
          <span>Must Mention <span className="muted small-text">(one per line; keeps only videos whose title, description or tags contain one, as a whole word)</span></span>
          <textarea rows={4} value={mentions} placeholder="Leave empty to keep every video" onChange={(e) => setMentions(e.target.value)} />
        </label>
        <div className="outside-options">
          <fieldset>
            <legend>Format</legend>
            {FORMATS.map((f) => (
              <label key={f.id}><input type="radio" name={`format-${topic}`} checked={draft.format === f.id} onChange={() => setDraft({ ...draft, format: f.id })} /> {f.label}</label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Languages</legend>
            {REACHES.map((r) => (
              <label key={r.id}><input type="radio" name={`reach-${topic}`} checked={draft.reach === r.id} onChange={() => setDraft({ ...draft, reach: r.id })} /> {r.label}</label>
            ))}
          </fieldset>
          <label title="Not used yet: the vidIQ step comes later.">
            <input type="checkbox" checked={draft.vidiq} onChange={(e) => setDraft({ ...draft, vidiq: e.target.checked })} /> Include vidIQ Results <span className="muted small-text">(Coming Soon; Uses vidIQ Credits)</span>
          </label>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="research-actions">
        <button type="button" className="small" disabled={!changed || !!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save Settings'}</button>
        <button type="button" className="small" disabled={changed || !!busy} onClick={() => void scan()}>{busy === 'scan' ? 'Scanning YouTube…' : 'Scan YouTube Now'}</button>
        <span className="muted small-text">
          {changed
            ? (searchChanged ? 'Save the settings, then scan again.' : 'Save to re-filter the last scan; no new search needed.')
            : `About ${overview.estimate} YouTube units; ${overview.quotaLeft.toLocaleString()} left today.`}
        </span>
      </div>

      {latest ? (
        <>
          <button type="button" className="research-toggle small-text" aria-expanded={showVideos} onClick={() => setShowVideos(!showVideos)}>
            {showVideos ? '▼' : '▶'} Last Scan {new Date(latest.scannedAt).toLocaleString()}: {latest.videos.length} Found
            {latest.removed ? `, ${latest.kept} Kept, ${latest.removed} Removed by Must Mention` : ''} ({keptVideos.length - shorts} Longform, {shorts} Shorts Kept)
            {overview.scans.length > 1 ? ` · ${overview.scans.length - 1} Older Scans Saved` : ''}
          </button>
          {showVideos && (
            <>
              <div className="outside-filters small-text">
                <label>Show{' '}
                  <select value={keptFilter} onChange={(e) => setKeptFilter(e.target.value as KeptFilter)}>
                    <option value="kept">Kept ({latest.kept})</option>
                    <option value="removed">Removed ({latest.removed})</option>
                    <option value="all">All ({latest.videos.length})</option>
                  </select>
                </label>
                <label>Format{' '}
                  <select value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
                    <option value="all">Longform and Shorts</option>
                    <option value="longform">Longform</option>
                    <option value="short">Shorts</option>
                  </select>
                </label>
                <span className="muted">{shown.length} Videos</span>
              </div>
              <div className="outside-videos-scroll">
                <table className="outside-videos small-text">
                  <thead>
                    <tr>
                      {header('title', 'Video')}
                      {header('channelTitle', 'Channel')}
                      {header('seconds', 'Length')}
                      {header('views', 'Views')}
                      {header('publishedAt', 'Published')}
                      <th>Mentions</th>
                      <th>Found By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => (
                      <tr key={v.id} className={v.kept ? undefined : 'removed'}>
                        <td><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`} target="_blank" rel="noreferrer">{v.title}</a>{v.language && !v.language.startsWith('en') ? <span className="muted"> ({v.language})</span> : null}</td>
                        <td>{v.channelTitle}</td>
                        <td>{v.kind === 'short' ? 'Short' : 'Longform'} <span className="muted">{formatLength(v.seconds)}</span></td>
                        <td className="number">{formatNumber(v.views)}</td>
                        <td>{v.publishedAt.slice(0, 10)}</td>
                        <td>{v.mentions.join(', ') || <span className="muted">—</span>}</td>
                        <td className="muted">{v.foundBy.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : <p className="muted small-text">No scans yet.</p>}
    </div>
  );
}
