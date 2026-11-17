import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';

export function ExpressionShotList({ active }: { active: boolean }) {
  const [shots, setShots] = useState<ExpressionShot[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!active) return;
    let activeRequest = true;
    const load = () => { void getJson<ExpressionShot[]>('/api/expressions/shot-list').then(value => { if (activeRequest) { setShots(value); setError(''); } }, (e: Error) => { if (activeRequest) setError(e.message); }); };
    load(); window.addEventListener('hq-expression-shot-list-changed', load);
    return () => { activeRequest = false; window.removeEventListener('hq-expression-shot-list-changed', load); };
  }, [active]);
  const setDone = async (shot: ExpressionShot, done: boolean) => {
    setBusy(shot.id); setError('');
    try { setShots(await postJson<ExpressionShot[]>('/api/expressions/shot-list/status', { id: shot.id, done })); window.dispatchEvent(new Event('hq-expression-shot-list-changed')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };
  const ordered = [...(shots ?? [])].sort((a, b) => Number(a.done) - Number(b.done));
  return <section className="expression-shot-list">
    <h2>Expression Shot List</h2>
    <p>Expressions to photograph when you have time. Add suggestions from a video’s Generate Packaging section.</p>
    <p className="muted small-text">Saved in Expression Shot List.json in your Expressions folder.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {!shots && !error && <p className="muted">Loading Shot List…</p>}
    {shots && !shots.length && <p className="muted">No shots on the list yet.</p>}
    {ordered.map(shot => <article className={`expression-shot${shot.done ? ' is-done' : ''}`} key={shot.id}>
      <label><input type="checkbox" checked={shot.done} disabled={!!busy} onChange={e => void setDone(shot, e.target.checked)} /> <strong>{shot.done ? 'Done' : 'To Photograph'}</strong></label>
      <p>{shot.expression}</p>
      {shot.sources.length > 0 && <details><summary>Suggested For ({shot.sources.length})</summary><ul>{shot.sources.map((source, i) => <li key={`${source.piece}-${source.context}-${i}`}>{source.piece.split('/').join(' › ')}{source.context && ` · ${source.context}`}</li>)}</ul></details>}
    </article>)}
  </section>;
}
