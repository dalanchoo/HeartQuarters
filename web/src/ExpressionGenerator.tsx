import { useEffect, useState } from 'react';
import { getJson, postJson, thumbUrl, type ExpressionCategory, type ExpressionPhoto } from './api';

type Job = { id: string; category: string; ai: 'codex' | 'gemini' | 'unknown'; state: 'working' | 'ready' | 'failed'; error?: string; prompt: string; references: string[]; recovered?: boolean };

export function ExpressionGenerator({ category, references, photos, onStarted, onViewPhoto }: { category: ExpressionCategory; references: string[]; photos: ExpressionPhoto[]; onStarted: () => void; onViewPhoto: (photo: ExpressionPhoto) => void }) {
  const available = references.filter((p) => photos.some((photo) => photo.path === p));
  const [chosen, setChosen] = useState(() => available.slice(0, 3));
  const [framing, setFraming] = useState('HeadShoulders'); const [angle, setAngle] = useState(''); const [gaze, setGaze] = useState('');
  const [ai, setAi] = useState<'codex' | 'gemini'>('codex');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [prompt, setPrompt] = useState('');
  useEffect(() => {
    let active = true;
    setPrompt('');
    const params = new URLSearchParams({ category: category.path, framing, angle, gaze });
    void getJson<{ prompt: string }>(`/api/expression-generation/prompt?${params}`).then((result) => { if (active) setPrompt(result.prompt); }, (e) => { if (active) setMessage(e.message); });
    return () => { active = false; };
  }, [category.path, framing, angle, gaze]);
  const start = async () => {
    setBusy(true); setMessage('');
    try { await postJson('/api/expression-generation/start', { category: category.path, references: chosen, options: { framing, angle, gaze }, ai }); setMessage('Generation started. The candidate will appear in Candidates for Review.'); onStarted(); }
    catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="expression-planning"><summary>Generate an Expression</summary>
    <p>Choose up to five reference photos for likeness. Candidates stay on this computer until you approve or discard them.</p>
    <div className="reference-grid">{available.map((p) => { const photo = photos.find((item) => item.path === p)!; return <div key={p}><button type="button" className="expression-view-image" onClick={() => onViewPhoto(photo)} aria-label={`View ${photo.name}`}><img src={thumbUrl('expressions', p, 240)} alt={photo.name} /></button><label><input type="checkbox" checked={chosen.includes(p)} disabled={!chosen.includes(p) && chosen.length >= 5} onChange={(e) => setChosen(e.target.checked ? [...chosen, p] : chosen.filter((v) => v !== p))} /> Use Reference</label></div>; })}</div>
    {!available.length && <p>Select reference photos above before generating.</p>}
    <div className="expression-generator-options"><label>Image Generator <select value={ai} onChange={(e) => setAi(e.target.value as 'codex' | 'gemini')}><option value="codex">ChatGPT</option><option value="gemini">Gemini</option></select></label><label>Framing <select value={framing} onChange={(e) => setFraming(e.target.value)}><option value="">Natural</option><option value="HeadShoulders">Head and Shoulders</option><option value="UpperBody">Upper Body</option><option value="CloseUp">Close-Up</option></select></label>
    <label>Face Direction <select value={angle} onChange={(e) => setAngle(e.target.value)}><option value="">Natural</option><option value="Frontal">Frontal</option><option value="ThreeQuarter">Three-Quarter</option><option value="LeftFacing">Face Left</option><option value="RightFacing">Face Right</option></select></label>
    <label>Gaze <select value={gaze} onChange={(e) => setGaze(e.target.value)}><option value="">Natural</option><option value="LookAtCamera">At Camera</option><option value="LookOffCamera">Away From Camera</option><option value="LookLeft">Left</option><option value="LookRight">Right</option><option value="LookUp">Up</option><option value="LookDown">Down</option></select></label></div>
    <details className="expression-prompt"><summary>View Prompt</summary><p>{prompt || 'Loading prompt…'}</p>{ai === 'gemini' && <p>Gemini also receives the paths to the selected reference photos.</p>}</details>
    <button disabled={busy || !chosen.length || !prompt} onClick={() => void start()}>Generate Candidate</button>
    {message && <p role="status">{message}</p>}
  </details>;
}

export function ExpressionCandidates({ categories, revision, onSaved, onViewCandidate }: { categories: ExpressionCategory[]; revision: number; onSaved: () => void; onViewCandidate: (id: string, category: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]); const [message, setMessage] = useState(''); const [busy, setBusy] = useState<string | null>(null);
  const load = async () => { try { setJobs(await getJson<Job[]>('/api/expression-generation/jobs')); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } };
  useEffect(() => { void load(); }, [revision]);
  useEffect(() => { const timer = setInterval(() => void load(), 3000); return () => clearInterval(timer); }, []);
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
      {job.recovered && <label>Category <select value={job.category} disabled={busy !== null} onChange={(e) => { if (e.target.value) void action(job.id, async () => { await postJson('/api/expression-generation/assign-category', { id: job.id, category: e.target.value }); }); }}><option value="">Choose a category…</option>{categories.filter(c => c.path && !parents.has(c.path)).map(c => <option key={c.path} value={c.path}>{c.path.split('/').join(' › ')}</option>)}</select></label>}
      <details className="expression-prompt"><summary>View Prompt</summary><p>{job.prompt || 'The prompt was not saved for this older candidate.'}</p></details>
      <div className="expression-candidate-actions">{job.state === 'ready' && <button disabled={busy !== null || !job.category} onClick={() => void action(job.id, async () => { const result = await postJson<{ path: string }>('/api/expression-generation/approve', { id: job.id }); setMessage(`Added ${result.path}`); onSaved(); })}>Approve and Add to Category</button>}
      {job.state !== 'working' && <button disabled={busy !== null} onClick={() => void action(job.id, async () => { await postJson('/api/expression-generation/reject', { id: job.id }); setMessage('Candidate discarded.'); })}>Discard Candidate</button>}</div>
    </article>)}</div>
  </details>;
}
