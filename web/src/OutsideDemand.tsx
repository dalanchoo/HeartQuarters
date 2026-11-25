// Channel -> Research -> Outside Demand: what other channels made on a topic, from a YouTube search.
// Kept apart from "Your Channel Evidence" on purpose.
import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ResearchTopic } from '../../server/channel-research';
import type { OutsideOverview, ScanFormat, ScanReach, ScanSettings } from '../../server/outside-youtube';

const FORMATS: { id: ScanFormat; label: string }[] = [{ id: 'longform', label: 'Longform' }, { id: 'short', label: 'Shorts' }, { id: 'both', label: 'Both' }];
const REACHES: { id: ScanReach; label: string }[] = [{ id: 'english', label: 'English Only' }, { id: 'worldwide', label: 'Worldwide (Translated in Reports)' }];
const SHOWN_VIDEOS = 50;

function formatNumber(n: number | null): string {
  return n === null ? '—' : n.toLocaleString();
}

function formatLength(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

export function OutsideDemand({ topic }: { topic: ResearchTopic }) {
  const [overview, setOverview] = useState<OutsideOverview | null>(null);
  const [draft, setDraft] = useState<ScanSettings | null>(null);
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState<'save' | 'scan' | null>(null);
  const [showVideos, setShowVideos] = useState(false);
  const [error, setError] = useState('');

  const show = (data: OutsideOverview) => {
    setOverview(data);
    setDraft(data.settings);
    setWords(data.settings.searchWords.join('\n'));
  };

  useEffect(() => {
    getJson<OutsideOverview>(`/api/channel/research/outside?topic=${encodeURIComponent(topic)}`).then(show, (e: Error) => setError(e.message));
  }, [topic]);

  if (!overview || !draft) return error ? <p className="error" role="alert">{error}</p> : <p className="muted small-text">Loading Outside Demand…</p>;

  const pending: ScanSettings = { ...draft, searchWords: words.split('\n') };
  const changed = JSON.stringify({ ...pending, searchWords: pending.searchWords.map((w) => w.trim()).filter(Boolean) }) !== JSON.stringify(overview.settings);

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

  const latest = overview.latest;
  const shorts = latest?.videos.filter((v) => v.kind === 'short').length ?? 0;

  return (
    <div className="outside-demand">
      <p className="muted small-text">
        What other YouTube channels made on this topic. Kept separate from your channel evidence. Your own videos are left out.
      </p>
      <div className="outside-settings">
        <label className="outside-words">
          <span>Search Words <span className="muted small-text">(one per line, up to 8)</span></span>
          <textarea rows={3} value={words} onChange={(e) => setWords(e.target.value)} />
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
          <label title="Not used yet: the vidIQ step comes next.">
            <input type="checkbox" checked={draft.vidiq} onChange={(e) => setDraft({ ...draft, vidiq: e.target.checked })} /> Include vidIQ Results <span className="muted small-text">(Coming Soon; Uses vidIQ Credits)</span>
          </label>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="research-actions">
        <button type="button" className="small" disabled={!changed || !!busy} onClick={() => void save()}>{busy === 'save' ? 'Saving…' : 'Save Settings'}</button>
        <button type="button" className="small" disabled={changed || !!busy} onClick={() => void scan()}>{busy === 'scan' ? 'Scanning YouTube…' : 'Scan YouTube Now'}</button>
        <span className="muted small-text">
          {changed ? 'Save the settings before scanning.' : `About ${overview.estimate} YouTube units; ${overview.quotaLeft.toLocaleString()} left today.`}
        </span>
      </div>

      {latest ? (
        <>
          <button type="button" className="research-toggle small-text" aria-expanded={showVideos} onClick={() => setShowVideos(!showVideos)}>
            {showVideos ? '▼' : '▶'} Last Scan {new Date(latest.scannedAt).toLocaleString()}: {latest.videos.length} Videos ({latest.videos.length - shorts} Longform, {shorts} Shorts)
            {overview.scans.length > 1 ? ` · ${overview.scans.length - 1} Older Scans Saved` : ''}
          </button>
          {showVideos && (
            <table className="outside-videos small-text">
              <thead><tr><th>Video</th><th>Channel</th><th>Kind</th><th>Views</th><th>Published</th><th>Found By</th></tr></thead>
              <tbody>
                {latest.videos.slice(0, SHOWN_VIDEOS).map((v) => (
                  <tr key={v.id}>
                    <td><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`} target="_blank" rel="noreferrer">{v.title}</a>{v.language && !v.language.startsWith('en') ? <span className="muted"> ({v.language})</span> : null}</td>
                    <td>{v.channelTitle}</td>
                    <td>{v.kind === 'short' ? 'Short' : 'Longform'} <span className="muted">{formatLength(v.seconds)}</span></td>
                    <td className="number">{formatNumber(v.views)}</td>
                    <td>{v.publishedAt.slice(0, 10)}</td>
                    <td className="muted">{v.foundBy.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {showVideos && latest.videos.length > SHOWN_VIDEOS && <p className="muted small-text">Showing the {SHOWN_VIDEOS} most viewed of {latest.videos.length}. All are saved in Drive.</p>}
        </>
      ) : <p className="muted small-text">No scans yet.</p>}
    </div>
  );
}
