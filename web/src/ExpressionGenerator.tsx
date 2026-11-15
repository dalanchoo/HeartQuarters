import { useEffect, useState } from 'react';
import { getJson, postJson, thumbUrl, type ExpressionCategory, type ExpressionPhoto } from './api';
type Job = { id: string; state: 'working' | 'ready' | 'failed'; error?: string };
export function ExpressionGenerator({ category, references, photos, onSaved }: { category: ExpressionCategory; references: string[]; photos: ExpressionPhoto[]; onSaved: () => void }) {
  const available = references.filter((p) => photos.some((photo) => photo.path === p));
  const [chosen, setChosen] = useState(() => available.slice(0, 3));
  const [framing, setFraming] = useState('HeadShoulders'); const [angle, setAngle] = useState(''); const [gaze, setGaze] = useState('');
  const [job, setJob] = useState<Job | null>(null); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { let active = true; void getJson<Job[]>(`/api/expression-generation/jobs?category=${encodeURIComponent(category.path)}`).then((items) => { if (active) { setJob(items.at(-1) ?? null); setLoaded(true); } }, (e) => { if (active) setMessage(e.message); }); return () => { active = false; }; }, [category.path]);
  useEffect(() => { if (job?.state !== 'working') return; const timer = setInterval(() => { void getJson<Job>(`/api/expression-generation/job?id=${encodeURIComponent(job.id)}`).then(setJob, (e) => setMessage(e.message)); }, 2000); return () => clearInterval(timer); }, [job?.id, job?.state]);
  const action = async (fn: () => Promise<void>) => { setBusy(true); setMessage(''); try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <details className="expression-planning"><summary>Generate an Expression With ChatGPT</summary>
    <p>Choose up to five reference photos for likeness. The result is temporary until you approve it.</p>
    <div className="reference-grid">{available.map((p) => <label key={p}><img src={thumbUrl('expressions', p, 240)} alt={photos.find((photo) => photo.path === p)?.name ?? p} /><input type="checkbox" checked={chosen.includes(p)} disabled={!!job || (!chosen.includes(p) && chosen.length >= 5)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p] : chosen.filter((v) => v !== p))} /> Use Reference</label>)}</div>
    {!available.length && <p>Select reference photos above before generating.</p>}
    <div className="expression-generator-options"><label>Framing <select value={framing} onChange={(e) => setFraming(e.target.value)} disabled={!!job}><option value="">Natural</option><option value="HeadShoulders">Head and Shoulders</option><option value="UpperBody">Upper Body</option><option value="CloseUp">Close-Up</option></select></label>
    <label>Face Direction <select value={angle} onChange={(e) => setAngle(e.target.value)} disabled={!!job}><option value="">Natural</option><option value="Frontal">Frontal</option><option value="ThreeQuarter">Three-Quarter</option><option value="LeftFacing">Face Left</option><option value="RightFacing">Face Right</option></select></label>
    <label>Gaze <select value={gaze} onChange={(e) => setGaze(e.target.value)} disabled={!!job}><option value="">Natural</option><option value="LookAtCamera">At Camera</option><option value="LookOffCamera">Away From Camera</option><option value="LookLeft">Left</option><option value="LookRight">Right</option><option value="LookUp">Up</option><option value="LookDown">Down</option></select></label></div>
    {!job && <button disabled={!loaded || busy || !chosen.length} onClick={() => void action(async () => { setJob(await postJson<Job>('/api/expression-generation/start', { category: category.path, references: chosen, options: { framing, angle, gaze } })); })}>Generate Candidate</button>}
    {job?.state === 'working' && <p role="status">ChatGPT is generating the image… This can take several minutes.</p>}
    {job?.state === 'failed' && <p className="error">{job.error}</p>}
    {job?.state === 'ready' && <><img className="expression-candidate" src={`/api/expression-generation/image?id=${encodeURIComponent(job.id)}`} alt={`Generated ${category.name} candidate`} /><p>Review the likeness and expression before approving.</p><button disabled={busy} onClick={() => void action(async () => { const result = await postJson<{ path: string }>('/api/expression-generation/approve', { id: job.id }); setJob(null); setMessage(`Added ${result.path}`); onSaved(); })}>Approve and Add to Category</button>{' '}</>}
    {job && job.state !== 'working' && <button disabled={busy} onClick={() => void action(async () => { await postJson('/api/expression-generation/reject', { id: job.id }); setJob(null); setMessage('Candidate discarded.'); })}>Discard Candidate</button>}
    {message && <p role="status">{message}</p>}
  </details>;
}
