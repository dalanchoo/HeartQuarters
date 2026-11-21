import { useState } from 'react';
import { openInExplorer, postJson } from './api';
import { ReachSetup } from './ReachSetup';

interface Result { file: string; missingRetention: string[]; emptyStatistics: string[]; unavailableBreakdowns: string[]; reach?: { status: string; note: string; truncated?: boolean } }

export function VideoAnalytics({ piece, id, onDownloaded }: { piece: string; id?: string; onDownloaded?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const download = async () => {
    if (!id) return;
    setBusy(true); setError(''); setResult(null);
    try {
      setResult(await postJson<Result>('/api/youtube/analytics/video', { piece, id }));
      onDownloaded?.();
      window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece })); // the views on the title
    }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="video-analytics">
    <div className="yt-linkbar-row">
      <button type="button" disabled={busy || !id} onClick={() => void download()}>{busy ? 'Downloading Stats…' : 'Download Video Stats'}</button>
      <span className="muted small-text">{id ? 'about 1 Data API unit + 11 Analytics units; reach reporting may add up to 101 Reporting requests' : 'Link this video to YouTube above to download its stats.'}</span>
    </div>
    {id && <ReachSetup />}
    {busy && <span role="status"> Downloading statistics and retention from YouTube…</span>}
    {error && <p className="error" role="alert">{error}</p>}
    {result && <div role="status"><p>Stats saved to {result.file}. <button type="button" onClick={() => void openInExplorer('projects', result.file)}>Select in Explorer</button></p>
      {result.missingRetention.length > 0 && <p>Retention was unavailable or empty for: {result.missingRetention.join(', ')}.</p>}
      {result.emptyStatistics.length > 0 && <p>YouTube returned no statistics for: {result.emptyStatistics.join(', ')}.</p>}
      {result.unavailableBreakdowns?.length > 0 && <p>YouTube returned no data for: {result.unavailableBreakdowns.join(', ')}.</p>}
      {result.reach && <p>Impressions and CTR: {result.reach.note}{result.reach.truncated ? ' Some reports or rows were omitted.' : ''}</p>}
      <p className="muted small-text">Periods use Pacific calendar days; the first month is 30 days. YouTube data may be delayed.</p>
    </div>}
  </div>;
}
