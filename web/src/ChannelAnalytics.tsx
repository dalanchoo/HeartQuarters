import { useState } from 'react';
import { openInExplorer, postJson } from './api';
import { AnalyticsAnalysis } from './AnalyticsAnalysis';
import { ReachSetup } from './ReachSetup';

interface Result { file: string; channel: string; emptyReports: string[]; topVideoCount: number; reach?: { status: string; note: string; truncated?: boolean } }
export function ChannelAnalytics() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const download = async () => {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await postJson<Result>('/api/youtube/analytics/channel')); setRefresh(n => n + 1); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="sidebar-section">
    <summary>Channel Analytics</summary>
    <button type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Downloading Channel Stats…' : 'Download Channel Stats'}</button>
    <span className="muted small-text"> about 1 Data API unit + 9 Analytics units; reach reporting may add up to 101 Reporting requests</span>
    <ReachSetup />
    {busy && <p role="status">Downloading channel statistics…</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {result && <div role="status"><p>Saved stats for {result.channel} to {result.file}.</p>
      <button type="button" onClick={() => void openInExplorer('projects', result.file)}>Select in Explorer</button>
      <p className="small-text">Top-video report: {result.topVideoCount} videos (maximum 200). This report may not include every video. Data may be delayed.</p>
      {result.reach && <p>Impressions and CTR: {result.reach.note}{result.reach.truncated ? ' Some reports or rows were omitted.' : ''}</p>}
      {result.emptyReports.length > 0 && <p>Empty reports: {result.emptyReports.join(', ')}.</p>}
    </div>}
    <AnalyticsAnalysis piece="" refresh={refresh} />
  </details>;
}
