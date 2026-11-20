import { useEffect, useMemo, useState } from 'react';
import { getJson, postJson, type ExpressionIndex } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';
import { CopyButton } from './PackagingDoc';
import { ExpressionVideos } from './ExpressionVideos';
import {
  buildPromptsFromGaps,
  buildPromptsFromShotList,
  findLibraryGaps,
  type VideoGazeDirection,
  type VideoPromptMode,
} from './expressionVideoPrompts';

export function ExpressionShotList({ active, index, onGenerate }: { active: boolean; index: ExpressionIndex | null; onGenerate: (shot: ExpressionShot) => void }) {
  const [shots, setShots] = useState<ExpressionShot[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [promptMode, setPromptMode] = useState<VideoPromptMode>('shot-list');
  const [gaze, setGaze] = useState<VideoGazeDirection>('right');
  const [perClip, setPerClip] = useState(3);
  const [maxPhotos, setMaxPhotos] = useState(2);

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

  const remove = async (shot: ExpressionShot) => {
    if (!window.confirm(`Delete “${shot.title || shot.description}” from the Shot List? This cannot be undone.`)) return;
    setBusy(shot.id); setError('');
    try { setShots(await postJson<ExpressionShot[]>('/api/expressions/shot-list/delete', { id: shot.id })); window.dispatchEvent(new Event('hq-expression-shot-list-changed')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const remaining = shots?.filter(shot => !shot.done) ?? [];
  const photographed = shots?.filter(shot => shot.done) ?? [];
  const gaps = useMemo(() => (index ? findLibraryGaps(index) : []), [index]);
  const gapMatches = useMemo(() => gaps.filter(g => g.count <= maxPhotos), [gaps, maxPhotos]);
  const videoPrompts = useMemo(() => {
    if (promptMode === 'shot-list') return buildPromptsFromShotList(shots ?? [], gaze, perClip);
    return buildPromptsFromGaps(gaps, gaze, perClip, maxPhotos);
  }, [promptMode, shots, gaps, gaze, perClip, maxPhotos]);

  const known = new Set(index?.categories.map(c => c.path) ?? []);
  const folderLabel = (path: string) => path ? path.split('/').join(' > ') : 'Not Yet Sorted';
  const card = (shot: ExpressionShot) => {
    const tags = ([['Framing', shot.framing], ['Pose', shot.pose], ['Morphology', shot.morphology]] as const).filter(([, list]) => list.length);
    return <details className={`expression-shot${shot.done ? ' is-done' : ''}`} key={shot.id}>
      <summary><strong>{shot.title || shot.description || 'Untitled Shot'}</strong></summary>
      {shot.title && <p>{shot.description || <span className="muted">No description yet.</span>}</p>}
      {tags.length > 0 && <p className="expression-shot-tags">{tags.map(([name, list]) => <span key={name}><strong>{name}:</strong> {list.join(', ')}</span>)}</p>}
      {shot.alsoFits.length > 0 && <p className="muted small-text">Also Fits: {shot.alsoFits.map(folderLabel).join(', ')}</p>}
      <div className="expression-shot-actions">
        {!shot.done && <button className="small" disabled={!known.has(shot.category)} title={known.has(shot.category) ? undefined : 'Sort this shot into an expression folder first.'} onClick={() => onGenerate(shot)}>Generate Reference With AI</button>}
        <button className="small" disabled={!!busy} onClick={() => void setDone(shot, !shot.done)}>{shot.done ? 'Move Back to To Photograph' : 'Mark Done'}</button>
        <button className="small" disabled={!!busy} onClick={() => void remove(shot)}>Delete</button>
      </div>
    </details>;
  };
  const byFolder = new Map<string, ExpressionShot[]>();
  for (const shot of remaining) byFolder.set(shot.category, [...(byFolder.get(shot.category) ?? []), shot]);
  const folders = [...byFolder.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));

  return <section className="expression-shot-list">
    <h2>Expression Shot List</h2>
    <p>Expressions to photograph when you have time. Add suggestions from a video’s Generate Packaging section.</p>
    <p className="muted small-text">Saved in Expression Shot List.json in your Expressions folder.</p>
    {error && <p className="error" role="alert">{error}</p>}

    {!shots && !error && <p className="muted">Loading Shot List…</p>}
    {shots && <section className="expression-shot-groups">
      <details className="yt-section expression-shot-group" open><summary>To Photograph ({remaining.length})</summary>
      {!remaining.length && <p className="muted small-text">No shots waiting to be photographed.</p>}
      {folders.map(folder => <details className="yt-section expression-shot-group" key={folder || 'unsorted'}>
        <summary>{folderLabel(folder)} ({byFolder.get(folder)!.length})</summary>
        {byFolder.get(folder)!.map(card)}
      </details>)}
      </details>
      {photographed.length > 0 && <details className="yt-section expression-shot-group"><summary>Photographed ({photographed.length})</summary>{photographed.map(card)}</details>}
    </section>}
    <details className="yt-section video-prompt-builder">
      <summary>AI Video Prompts (Seed With Reference Photo)</summary>
      <p className="muted small-text">
        Google Veo in Gemini generates up to 8 seconds per clip (up to 15 seconds on newer Gemini video models). Using 3 expressions per 8s clip (or 2 when turning both directions) leaves room for smooth head turns and a ~1.5s still hold on each pose.
      </p>
      <div className="video-prompt-controls">
        <label>
          Source{' '}
          <select value={promptMode} onChange={e => setPromptMode(e.target.value as VideoPromptMode)}>
            <option value="shot-list">From Shot List ({remaining.length} waiting)</option>
            <option value="library-gaps">Fill Library Gaps ({gapMatches.length} categories)</option>
          </select>
        </label>
        <label>
          Gaze Direction{' '}
          <select value={gaze} onChange={e => setGaze(e.target.value as VideoGazeDirection)}>
            <option value="right">Camera Right (for Left Side of Thumbnail)</option>
            <option value="left">Camera Left (for Right Side of Thumbnail)</option>
            <option value="both">Both (Right Then Left)</option>
          </select>
        </label>
        <label>
          Expressions per Clip{' '}
          <select value={perClip} onChange={e => setPerClip(Number(e.target.value))}>
            <option value={2}>2 (8s clip w/ both turns)</option>
            <option value={3}>3 (8s Veo clip)</option>
            <option value={4}>4 (~10–12s clip)</option>
            <option value={5}>5 (~12–15s clip)</option>
          </select>
        </label>
        {promptMode === 'library-gaps' && (
          <label>
            Include Categories With{' '}
            <select value={maxPhotos} onChange={e => setMaxPhotos(Number(e.target.value))}>
              <option value={0}>0 photos (Empty only)</option>
              <option value={1}>0–1 photos</option>
              <option value={2}>0–2 photos</option>
              <option value={3}>0–3 photos</option>
            </select>
          </label>
        )}
      </div>

      {!videoPrompts.length ? (
        <p className="muted small-text">
          {promptMode === 'shot-list' ? 'No shots waiting in To Photograph.' : 'No expression categories match that photo count.'}
        </p>
      ) : (
        <div className="video-prompt-list">
          {videoPrompts.map((item, i) => (
            <details className="yt-section video-prompt-card" key={i}>
              <summary className="video-prompt-head">
                <strong>{item.title}</strong>
                <CopyButton text={item.prompt} label="Copy Prompt" />
              </summary>
              <pre className="video-prompt-text">{item.prompt}</pre>
            </details>
          ))}
        </div>
      )}
    </details>

    <ExpressionVideos active={active} />
  </section>;
}
