import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, thumbUrl, type ExpressionCategory, type ExpressionPhoto } from './api';
import { CategoryPicker } from './CategoryPicker';
import { filterSelectablePhotos } from './expressionPlanning';
import { emptyPhotoFilters, ExpressionPhotoFilters } from './ExpressionPhotoFilters';

type Job = { id: string; category: string; ai: 'codex' | 'gemini' | 'unknown'; state: 'working' | 'ready' | 'failed'; error?: string; prompt: string; references: string[]; recovered?: boolean };

export function ExpressionGenerator({ category, references, photos, categories, onStarted, onViewPhoto, onToggleStar, starBusy }: { category: ExpressionCategory; references: string[]; photos: ExpressionPhoto[]; categories: ExpressionCategory[]; onStarted: () => void; onViewPhoto: (photo: ExpressionPhoto) => void; onToggleStar: (path: string, starred: boolean) => void; starBusy: boolean }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [scope, setScope] = useState<'starred' | 'all'>('starred'); const [filters, setFilters] = useState(emptyPhotoFilters);
  useEffect(() => { setChosen(current => current.filter(path => photos.some(photo => photo.path === path))); }, [photos]);
  const [framing, setFraming] = useState('HeadShoulders'); const [angle, setAngle] = useState(''); const [gaze, setGaze] = useState(''); const [ai, setAi] = useState<'codex' | 'gemini'>('codex');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [prompt, setPrompt] = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(true); const [suggested, setSuggested] = useState(''); const [outdated, setOutdated] = useState(false); const edited = useRef(false); const lastSuggestion = useRef('');
  useEffect(() => {
    let active = true; setLoadingPrompt(true); const params = new URLSearchParams({ category: category.path, framing, angle, gaze });
    void getJson<{ prompt: string }>(`/api/expression-generation/prompt?${params}`).then(result => {
      if (!active) return;
      if (edited.current && lastSuggestion.current && lastSuggestion.current !== result.prompt) setOutdated(true);
      if (!edited.current) setPrompt(result.prompt);
      lastSuggestion.current = result.prompt; setSuggested(result.prompt); setLoadingPrompt(false);
    }, e => { if (active) { setMessage(e.message); setLoadingPrompt(false); } });
    return () => { active = false; };
  }, [category.path, framing, angle, gaze]);
  const start = async () => {
    setBusy(true); setMessage('');
    try { await postJson('/api/expression-generation/start', { category: category.path, references: chosen, options: { framing, angle, gaze }, ai, prompt }); setMessage('Generation started. The candidate will appear in Candidates for Review.'); onStarted(); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const visible = filterSelectablePhotos(photos, references, { scope, category: filters.category, query: '', attributes: [filters.framing, filters.pose, filters.morphology], textFilters: filters });
  return <details className="expression-planning" open><summary>Generate an Expression</summary>
    <details className="yt-section generation-likeness">
    <summary>Likeness Photos ({chosen.length} of 5 Selected{chosen.length > 0 && `: ${chosen.map(path => photos.find(p => p.path === path)?.name ?? path).join(', ')}`})</summary>
    <p>Choose up to five photos for likeness. Stars are remembered; your choices here are for this candidate.</p>
    <div className="generation-photo-filters"><label>Photos <select value={scope} onChange={e => setScope(e.target.value as 'starred' | 'all')}><option value="starred">Starred Photos</option><option value="all">All Photos</option></select></label>
      <ExpressionPhotoFilters categories={categories} filters={filters} onChange={setFilters} /></div>
    <div className="generation-photo-grid">{visible.map(photo => { const selected = chosen.includes(photo.path); const starred = references.includes(photo.path); return <div className={`generation-photo-card${selected ? ' selected' : ''}`} key={photo.path}>
      <button type="button" className="generation-photo-select" aria-pressed={selected} disabled={!selected && chosen.length >= 5} onClick={() => setChosen(current => selected ? current.filter(p => p !== photo.path) : [...current, photo.path])}><img src={thumbUrl('expressions', photo.path, 240, photo.revision)} alt={photo.name} loading="lazy" /><span>{photo.name}</span></button>
      <div className="generation-photo-actions"><button type="button" disabled={starBusy} aria-pressed={starred} onClick={() => onToggleStar(photo.path, !starred)}>{starred ? '★ Starred' : '☆ Star'}</button><button type="button" onClick={() => onViewPhoto(photo)}>View</button></div></div>; })}</div>
    {!visible.length && <p className="muted">No photos match these filters. Choose All Photos to see the whole library.</p>}
    </details>
    {!chosen.length && <p className="muted small-text">Open Likeness Photos and choose at least one photo before generating.</p>}
    <div className="expression-generator-options"><label>Image Generator <select value={ai} onChange={e => setAi(e.target.value as 'codex' | 'gemini')}><option value="codex">ChatGPT</option><option value="gemini">Gemini</option></select></label><label>Framing <select value={framing} onChange={e => setFraming(e.target.value)}><option value="">Natural</option><option value="HeadShoulders">Head and Shoulders</option><option value="UpperBody">Upper Body</option><option value="CloseUp">Close-Up</option></select></label>
    <label>Face Direction <select value={angle} onChange={e => setAngle(e.target.value)}><option value="">Natural</option><option value="Frontal">Frontal</option><option value="ThreeQuarter">Three-Quarter</option><option value="LeftFacing">Face Left</option><option value="RightFacing">Face Right</option></select></label>
    <label>Gaze <select value={gaze} onChange={e => setGaze(e.target.value)}><option value="">Natural</option><option value="LookAtCamera">At Camera</option><option value="LookOffCamera">Away From Camera</option><option value="LookLeft">Left</option><option value="LookRight">Right</option><option value="LookUp">Up</option><option value="LookDown">Down</option></select></label></div>
    <label className="generation-prompt">Prompt <textarea rows={10} maxLength={30000} value={prompt} onChange={e => { edited.current = true; setPrompt(e.target.value); }} /></label>
    {outdated && <p role="status">Your prompt edits were kept when the options changed. Update the prompt if needed, or use the new suggested prompt.</p>}
    {edited.current && <button type="button" onClick={() => { setPrompt(suggested); edited.current = false; setOutdated(false); }}>Use Suggested Prompt</button>}
    {ai === 'gemini' && <p className="muted">Gemini also receives the selected reference photos.</p>}
    <button disabled={busy || loadingPrompt || !chosen.length || !prompt.trim()} onClick={() => void start()}>Generate Candidate</button>{message && <p role="status">{message}</p>}
  </details>;
}

export function ExpressionCandidates({ categories, revision, onSaved, onViewCandidate }: { categories: ExpressionCategory[]; revision: number; onSaved: () => void; onViewCandidate: (id: string, category: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { try { setJobs(await getJson<Job[]>('/api/expression-generation/jobs')); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { void load(); }, [revision]);
  const working = jobs.some(j => j.state === 'working');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [working]);
  const action = async (id: string, fn: () => Promise<void>) => { setBusy(id); setMessage(''); try { await fn(); await load(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); } };
  const parents = new Set(categories.map(c => c.parent));
  return <details className="expression-planning" open><summary>Candidates for Review ({jobs.length})</summary>
    <p>Compare candidates from every category. They stay on this computer until you decide.</p>
    {message && <p role="status">{message}</p>}
    {!jobs.length && <p className="muted">No candidates yet.</p>}
    <div className="expression-candidate-grid">{jobs.map(job => <article key={job.id} className="expression-candidate-card">
      <h3>{job.category ? job.category.split('/').join(' › ') : 'Recovered Candidate'}</h3>
      <p>{job.ai === 'unknown' ? 'Generator not recorded' : job.ai === 'gemini' ? 'Gemini' : 'ChatGPT'}</p>
      {job.state === 'working' && <p role="status">Generating… This can take several minutes.</p>}
      {job.state === 'failed' && <p className="error">{job.error}</p>}
      {job.state === 'ready' && <button type="button" className="expression-view-image expression-candidate-button" onClick={() => onViewCandidate(job.id, job.category)} aria-label={`View candidate for ${job.category || 'an unassigned category'}`}><img className="expression-candidate" src={`/api/expression-generation/image?id=${encodeURIComponent(job.id)}`} alt={`Candidate for ${job.category || 'an unassigned category'}`} loading="lazy" /></button>}
      {job.recovered && <CategoryPicker label="Category" value={job.category} disabled={busy !== null} options={categories.filter(c => c.path && !parents.has(c.path)).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }))} onChange={category => { void action(job.id, async () => { await postJson('/api/expression-generation/assign-category', { id: job.id, category }); }); }} />}
      <details className="expression-prompt"><summary>View Prompt</summary><p>{job.prompt || 'The prompt was not saved for this older candidate.'}</p></details>
      <div className="expression-candidate-actions">{job.state === 'ready' && <button disabled={busy !== null || !job.category} onClick={() => void action(job.id, async () => { const result = await postJson<{ path: string }>('/api/expression-generation/approve', { id: job.id }); setMessage(`Added ${result.path}`); onSaved(); })}>Approve and Add to Category</button>}
      {job.state !== 'working' && <button disabled={busy !== null} onClick={() => void action(job.id, async () => { await postJson('/api/expression-generation/reject', { id: job.id }); setMessage('Candidate discarded.'); })}>Discard Candidate</button>}</div>
    </article>)}</div>
  </details>;
}
