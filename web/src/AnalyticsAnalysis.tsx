import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, openInExplorer, postJson } from './api';
import type { AnalysisJob } from '../../server/analytics-analysis';
import { analyticsSummarySections } from './analyticsSummary';
import { VideoAnalytics } from './VideoAnalytics';
import { VideoStats } from './VideoStats';

type Run = { id: string; claude: string | null; codex: string | null; gemini: string | null; recommendations: string | null; summary: string | null; job: AnalysisJob | null; summaryJob: { state: string; error?: string } | null };
export function AnalyticsAnalysis({ piece, jobId, refresh = 0 }: { piece: string; jobId?: string; refresh?: number }) {
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  // Update Stats in the YouTube section downloads stats too: show the new download here as well.
  useEffect(() => { const downloaded = (e: Event) => { if ((e as CustomEvent).detail === piece) { setSelected(''); setTick(n => n + 1); } }; window.addEventListener('hq-video-stats-downloaded', downloaded); return () => window.removeEventListener('hq-video-stats-downloaded', downloaded); }, [piece]);
  useEffect(() => { let active = true; getJson<string[]>(`/api/youtube/analytics/snapshots?piece=${encodeURIComponent(piece)}`).then(list => { if (active) { setSnapshots(list); setSelected(current => list.includes(current) ? current : list[0] ?? ''); } }, (e: Error) => { if (active) setError(e.message); }); return () => { active = false; }; }, [piece, refresh, tick]);
  useEffect(() => {
    if (!selected) { setRuns([]); return; }
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const load = () => { void getJson<Run[]>(`/api/youtube/analytics/analysis?piece=${encodeURIComponent(piece)}&snapshot=${encodeURIComponent(selected)}`).then(items => { if (!active) return; setRuns(items); if (items.some(item => item.job?.state === 'working' || item.summaryJob?.state === 'working')) timer = setTimeout(load, 3000); }, (e: Error) => { if (active) setError(e.message); }); };
    load(); return () => { active = false; clearTimeout(timer); };
  }, [piece, selected, starting]);
  const start = async () => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/analyze', { piece, snapshot: selected }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const summarize = async (id: string) => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/summarize', { piece, snapshot: selected, id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const running = runs.some(run => run.job?.state === 'working');
  return <details className="yt-section"><summary>Analysis</summary>
    {piece && <VideoAnalytics key={jobId ?? 'unlinked'} piece={piece} id={jobId} onDownloaded={() => { setSelected(''); setTick(n => n + 1); }} />}
    {!snapshots.length ? <p>Download stats first.</p> : <><div className="yt-linkbar-row" style={{ marginTop: '0.5rem' }}><select aria-label="Snapshot" value={selected} onChange={e => setSelected(e.target.value)}>{snapshots.map(name => <option key={name}>{name}</option>)}</select>
      <button type="button" disabled={!selected || starting || running} onClick={() => void start()}>{piece ? 'Analyze With All Three AIs' : 'Find What to Make Next'}</button></div>
      <p className="muted small-text">Claude, ChatGPT, and Gemini review independently; Claude then combines their findings and writes a short summary. This uses your AI subscriptions and may take several minutes.</p>
      {piece && selected && <VideoStats piece={piece} snapshot={selected} />}</>}
    {error && <p className="error" role="alert">{error}</p>}
    {runs.map((run, index) => <details className="yt-section" key={run.id} open={index === 0 ? true : undefined}><summary style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}><span>Analysis {runs.length - index} · Snapshot {selected} {run.job?.state === 'working' ? '· Running' : run.recommendations ? '· Complete' : '· Incomplete'}</span><button type="button" style={{ marginLeft: 'auto' }} onClick={event => { event.stopPropagation(); void openInExplorer('projects', `${piece ? `${piece}/` : ''}Analytics/${selected}/Analysis/${run.id}`); }}>Open Analysis Folder</button></summary>
      {run.job && <p className="small-text">Claude: {run.job.models.claude.state}; ChatGPT: {run.job.models.codex.state}; Gemini: {run.job.models.gemini.state}; Recommendations: {run.job.synthesis.state}.</p>}
      {run.job && [run.job.models.claude.error, run.job.models.codex.error, run.job.models.gemini.error, run.job.synthesis.error].filter(Boolean).map((message, i) => <p key={i} className="error">{message}</p>)}
      {run.summary ? <details className="yt-section" open><summary>Summary for John</summary>{analyticsSummarySections(run.summary).map((section, i) => section.title ? <details className="yt-section" open key={i}><summary>{section.title}</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></div></details> : <div className="markdown" key={i}><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></div>)}</details> : run.summaryJob?.state === 'working' ? <p role="status">Preparing Summary…</p> : <>{(run.recommendations || run.claude || run.codex || run.gemini) && <button type="button" disabled={starting || run.job?.state === 'working'} onClick={() => void summarize(run.id)}>Create Readable Summary</button>}{run.summaryJob?.error && <p className="error">{run.summaryJob.error}</p>}</>}
      {([['Detailed Recommendations', run.recommendations], ['Claude Review', run.claude], ['ChatGPT Review', run.codex], ['Gemini Review', run.gemini]] as const).map(([name, content]) => content && <details className="yt-section" key={name}><summary>{name}</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div></details>)}
    </details>)}
  </details>;
}
