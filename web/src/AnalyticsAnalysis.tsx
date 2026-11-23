import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, openInExplorer, postJson } from './api';
import type { AnalysisJob } from '../../server/analytics-analysis';
import { analyticsSummarySections } from './analyticsSummary';
import { VideoStats } from './VideoStats';

type Run = { id: string; claude: string | null; codex: string | null; gemini: string | null; recommendations: string | null; summary: string | null; evidenceIds?: string[]; job: AnalysisJob | null; failure: string | null; summaryJob: { state: string; error?: string } | null };
export function AnalyticsAnalysis({ piece, videoId, refresh = 0, evidenceName }: { piece: string; videoId?: string; refresh?: number; evidenceName?: (id: string) => string | undefined }) {
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ piece, ...(videoId ? { videoId } : {}) });
    getJson<string[]>(`/api/youtube/analytics/snapshots?${params}`).then(list => {
      if (active) { setSnapshots(list); setSelected(current => list.includes(current) ? current : list[0] ?? ''); }
    }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [piece, videoId, refresh, tick]);
  useEffect(() => {
    if (!selected) { setRuns([]); return; }
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const load = () => { void getJson<Run[]>(`/api/youtube/analytics/analysis?piece=${encodeURIComponent(piece)}&snapshot=${encodeURIComponent(selected)}`).then(items => { if (!active) return; setRuns(items); if (items.some(item => item.job?.state === 'working' || item.summaryJob?.state === 'working')) timer = setTimeout(load, 3000); }, (e: Error) => { if (active) setError(e.message); }); };
    load(); return () => { active = false; clearTimeout(timer); };
  }, [piece, selected, starting]);
  const start = async () => {
    setStarting(true); setError('');
    try {
      if (videoId) {
        const { snapshot } = await postJson<{ snapshot: string }>('/api/channel/video-analysis', { videoId });
        setSelected(snapshot);
        setSnapshots(list => list.includes(snapshot) ? list : [snapshot, ...list]);
        setTick(n => n + 1);
        window.dispatchEvent(new CustomEvent('hq-video-status-changed', { detail: piece }));
      } else await postJson('/api/youtube/analytics/analyze', { piece, snapshot: selected });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStarting(false); }
  };
  const summarize = async (id: string) => { setStarting(true); setError(''); try { await postJson('/api/youtube/analytics/summarize', { piece, snapshot: selected, id }); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setStarting(false); } };
  const running = runs.some(run => run.job?.state === 'working');
  const startLabel = videoId ? 'Analyze Video' : 'Find What to Make Next';
  return <section aria-label={piece ? 'Video Analysis' : 'What to Make Next'}>
    {!videoId && !snapshots.length ? <p>Use Refresh YouTube Data to get a channel snapshot first.</p> :
      <div className="yt-linkbar-row">
        <button type="button" disabled={(!videoId && !selected) || starting || running} onClick={() => void start()}>{starting ? (videoId ? 'Preparing Video Stats…' : 'Starting Analysis…') : startLabel}</button>
        {!!snapshots.length && <label>Saved Snapshot <select value={selected} onChange={e => { setRuns([]); setSelected(e.target.value); }}>{snapshots.map(name => <option key={name}>{name}</option>)}</select></label>}
      </div>}
    {videoId && !selected && <p className="muted small-text">Analyze Video fetches detailed stats when needed.</p>}
    {piece && selected && <VideoStats key={selected} piece={piece} snapshot={selected} />}
    {error && <p className="error" role="alert">{error}</p>}
    {runs.map((run, index) => <details className="yt-section" key={run.id} open={index === 0 ? true : undefined}><summary style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}><span>Analysis {runs.length - index} · Snapshot {selected} {run.job?.state === 'working' ? '· Running' : run.recommendations ? '· Complete' : '· Incomplete'}</span><button type="button" style={{ marginLeft: 'auto' }} onClick={event => { event.stopPropagation(); void openInExplorer('projects', `${piece ? `${piece}/` : ''}Analytics/${selected}/Analysis/${run.id}`); }}>Open Analysis Folder</button></summary>
      {run.job && <p className="small-text">Claude: {run.job.models.claude.state}; ChatGPT: {run.job.models.codex.state}; Gemini: {run.job.models.gemini.state}; Recommendations: {run.job.synthesis.state}.</p>}
      {run.job && [run.job.models.claude.error, run.job.models.codex.error, run.job.models.gemini.error, run.job.synthesis.error].filter(Boolean).map((message, i) => <p key={i} className="error">{message}</p>)}
      {!run.recommendations && run.job?.state !== 'working' && <p className="small-text">
        {!run.job && (run.failure?.trim() || 'This run ended before recommendations were saved. The cause is unknown.')} {'Use '}<strong>{startLabel}</strong> to start a fresh run.
      </p>}
      {!!run.evidenceIds?.length && <div className="yt-linkbar-row">{run.evidenceIds.map(id => <a key={id} href={`#Channel/Video/${encodeURIComponent(id)}`}>{evidenceName?.(id) ?? 'Open Video Evidence'}</a>)}</div>}
      {run.summary ? <details className="yt-section" open><summary>Summary for John</summary>{analyticsSummarySections(run.summary).map((section, i) => section.title ? <details className="yt-section" open key={i}><summary>{section.title}</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></div></details> : <div className="markdown" key={i}><ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></div>)}</details> : run.summaryJob?.state === 'working' ? <p role="status">Preparing Summary…</p> : <>{(run.recommendations || run.claude || run.codex || run.gemini) && <button type="button" disabled={starting || run.job?.state === 'working'} onClick={() => void summarize(run.id)}>Create Readable Summary</button>}{run.summaryJob?.error && <p className="error">{run.summaryJob.error}</p>}</>}
      {([['Detailed Recommendations', run.recommendations], ['Claude Review', run.claude], ['ChatGPT Review', run.codex], ['Gemini Review', run.gemini]] as const).map(([name, content]) => content && <details className="yt-section" key={name}><summary>{name}</summary><div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div></details>)}
    </details>)}
  </section>;
}
