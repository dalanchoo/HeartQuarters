import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import { YouTubeIcon } from './YouTubeOpenLink';

export function ReachSetup() {
  const [access, setAccess] = useState<boolean | null>(null); const [url, setUrl] = useState(''); const [error, setError] = useState('');
  const check = () => getJson<{ reportingAccess?: boolean }>('/api/youtube/status').then(status => setAccess(!!status.reportingAccess), (e: Error) => setError(e.message));
  useEffect(() => { void check(); }, []);
  if (access === null || access) return null;
  return <details className="yt-section"><summary>Enable Automatic Impressions and CTR</summary>
    <p>Reconnect YouTube and allow analytics access. The next stats download starts a daily reach report if needed; YouTube may take a few days to prepare it and provides limited historical reports.</p>
    <button type="button" aria-label="Start YouTube Sign-In" onClick={() => { setError(''); void postJson<{ url: string }>('/api/youtube/connect').then(result => setUrl(result.url), (e: Error) => setError(e.message)); }}>Start <YouTubeIcon /> Sign-In</button>{' '}
    {url && <a href={url} target="_blank" rel="noreferrer">Open Google Sign-In ↗</a>}{' '}
    <button type="button" onClick={() => void check()}>I’ve Signed In</button>
    {error && <p className="error" role="alert">{error}</p>}
  </details>;
}
