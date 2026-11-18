import { useState, type ReactNode } from 'react';
import { openInExplorer, postJson } from './api';

interface Result { file: string; missingRetention: string[]; emptyStatistics: string[] }

export function VideoAnalytics({ piece, id, children }: { piece: string; id: string; children?: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await postJson<Result>('/api/youtube/analytics/video', { piece, id })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <div className="video-analytics">
    <div className="yt-linkbar-row">{children}<button type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Downloading Stats…' : 'Download Video Stats'}</button><span className="muted small-text">about 1 Data API unit + 8 Analytics units</span></div>
    {busy && <span role="status"> Downloading statistics and retention from YouTube…</span>}
    {error && <p className="error" role="alert">{error}</p>}
    {result && <div role="status"><p>Stats saved to {result.file}. <button type="button" onClick={() => void openInExplorer('projects', result.file)}>Open Folder</button></p>
      {result.missingRetention.length > 0 && <p>Retention was unavailable or empty for: {result.missingRetention.join(', ')}.</p>}
      {result.emptyStatistics.length > 0 && <p>YouTube returned no statistics for: {result.emptyStatistics.join(', ')}.</p>}
      <p className="muted small-text">Periods use Pacific calendar days; the first month is 30 days. YouTube data may be delayed.</p>
    </div>}
  </div>;
}
