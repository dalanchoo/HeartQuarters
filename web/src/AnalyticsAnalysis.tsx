import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { getJson, postJson } from './api';
import type { AnalysisJob } from '../../server/analytics-analysis';

type Run = { id: string; claude: string | null; codex: string | null; gemini: string | null; recommendations: string | null; job: AnalysisJob | null };
export function AnalyticsAnalysis({ piece, refresh }: { piece: string; refresh: number }) {
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  useEffect(() => { let active = true; getJson<string[]>(`/api/youtube/analytics/snapshots?piece=${encodeURIComponent(piece)}`).then(list => { if (active) { setSnapshots(list); setSelected(current => list.includes(current) ? current : list[0] ?? ''); } }, (e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [piece, refresh]);
  useEffect(() => {
    if (!selected) { setRuns([]); return; }
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const load = () => { void getJson<Run[]>(`/api/youtube/analytics/analysis?piece=${encodeURIComponent(piece)}&snapshot=${encodeURIComponent(selected)}`).then(items => { if (!active) return; setRuns(items); if (items.some(item => item.job?.state === 'working')) timer = setTimeout(load, 3000); }, (e: Error) => { if (active) setError(e.message); }); };
    load(); return () => { active = false; clearTimeout(timer); };
  }, [piece, selected, starting]);
  const start = async () => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/analyze', { piece, snapshot: selected }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const running = runs.some(run => run.job?.state === 'working');
  return <details className="sidebar-section"><summary>Analyze Saved Stats</summary>
    {!snapshots.length ? <p>Download stats first.</p> : <><label>Snapshot <select value={selected} onChange={e => setSelected(e.target.value)}>{snapshots.map(name => <option key={name}>{name}</option>)}</select></label>{' '}
      <button type="button" disabled={!selected || starting || running} onClick={() => void start()}>Analyze With All Three AIs</button>
      <p className="muted small-text">Claude, ChatGPT, and Gemini review independently; Claude then combines their findings. This uses your AI subscriptions and may take several minutes.</p></>}
    {error && <p className="error" role="alert">{error}</p>}
    {runs.map(run => <details key={run.id} open={run.job?.state === 'working'}><summary>Analysis {run.id.slice(0, 8)} {run.job?.state === 'working' ? '· Running' : run.recommendations ? '· Complete' : '· Incomplete'}</summary>
      {run.job && <p className="small-text">Claude: {run.job.models.claude.state}; ChatGPT: {run.job.models.codex.state}; Gemini: {run.job.models.gemini.state}; Recommendations: {run.job.synthesis.state}.</p>}
      {run.job && [run.job.models.claude.error, run.job.models.codex.error, run.job.models.gemini.error, run.job.synthesis.error].filter(Boolean).map((message, i) => <p key={i} className="error">{message}</p>)}
      {([['Recommendations', run.recommendations], ['Claude', run.claude], ['ChatGPT', run.codex], ['Gemini', run.gemini]] as const).map(([name, content]) => content && <details key={name}><summary>{name}</summary><div className="markdown"><ReactMarkdown>{content}</ReactMarkdown></div></details>)}
    </details>)}
  </details>;
}
