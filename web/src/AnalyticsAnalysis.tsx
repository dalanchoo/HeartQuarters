import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, openInExplorer, postJson } from './api';
import type { AnalysisJob } from '../../server/analytics-analysis';

type Run = { id: string; claude: string | null; codex: string | null; gemini: string | null; recommendations: string | null; summary: string | null; job: AnalysisJob | null; summaryJob: { state: string; error?: string } | null };
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
    const load = () => { void getJson<Run[]>(`/api/youtube/analytics/analysis?piece=${encodeURIComponent(piece)}&snapshot=${encodeURIComponent(selected)}`).then(items => { if (!active) return; setRuns(items); if (items.some(item => item.job?.state === 'working' || item.summaryJob?.state === 'working')) timer = setTimeout(load, 3000); }, (e: Error) => { if (active) setError(e.message); }); };
    load(); return () => { active = false; clearTimeout(timer); };
  }, [piece, selected, starting]);
  const start = async () => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/analyze', { piece, snapshot: selected }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const summarize = async (id: string) => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/summarize', { piece, snapshot: selected, id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const running = runs.some(run => run.job?.state === 'working');
  return <details className="yt-section"><summary>Analyze Saved Stats</summary>
    {!snapshots.length ? <p>Download stats first.</p> : <><label>Snapshot <select value={selected} onChange={e => setSelected(e.target.value)}>{snapshots.map(name => <option key={name}>{name}</option>)}</select></label>{' '}
      <button type="button" disabled={!selected || starting || running} onClick={() => void start()}>Analyze With All Three AIs</button>
      <p className="muted small-text">Claude, ChatGPT, and Gemini review independently; Claude then combines their findings and writes a short summary. This uses your AI subscriptions and may take several minutes.</p></>}
    {error && <p className="error" role="alert">{error}</p>}
    {runs.map((run, index) => <details className="yt-section" key={run.id} open={index === 0 ? true : undefined}><summary>Analysis {runs.length - index} · Snapshot {selected} {run.job?.state === 'working' ? '· Running' : run.recommendations ? '· Complete' : '· Incomplete'}</summary>
      {run.job && <p className="small-text">Claude: {run.job.models.claude.state}; ChatGPT: {run.job.models.codex.state}; Gemini: {run.job.models.gemini.state}; Recommendations: {run.job.synthesis.state}.</p>}
      {run.job && [run.job.models.claude.error, run.job.models.codex.error, run.job.models.gemini.error, run.job.synthesis.error].filter(Boolean).map((message, i) => <p key={i} className="error">{message}</p>)}
      {run.summary ? <details className="yt-section" open><summary>Summary for John</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{run.summary}</ReactMarkdown></div></details> : run.summaryJob?.state === 'working' ? <p role="status">Preparing Summary…</p> : <>{(run.recommendations || run.claude || run.codex || run.gemini) && <button type="button" disabled={starting || run.job?.state === 'working'} onClick={() => void summarize(run.id)}>Create Readable Summary</button>}{run.summaryJob?.error && <p className="error">{run.summaryJob.error}</p>}</>}
      <button type="button" onClick={() => void openInExplorer('projects', `${piece ? `${piece}/` : ''}Analytics/${selected}/Analysis/${run.id}`)}>Open Analysis Folder</button>
      {([['Detailed Recommendations', run.recommendations], ['Claude Review', run.claude], ['ChatGPT Review', run.codex], ['Gemini Review', run.gemini]] as const).map(([name, content]) => content && <details className="yt-section" key={name}><summary>{name}</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div></details>)}
    </details>)}
  </details>;
}
