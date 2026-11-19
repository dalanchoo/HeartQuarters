import { useEffect, useMemo, useState } from 'react';
import { getJson, postJson, type ExpressionIndex } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';
import { CopyButton } from './PackagingDoc';
import {
  buildPromptsFromGaps,
  buildPromptsFromShotList,
  findLibraryGaps,
  type VideoGazeDirection,
  type VideoPromptMode,
} from './expressionVideoPrompts';

export function ExpressionShotList({ active, index }: { active: boolean; index: ExpressionIndex | null }) {
  const [shots, setShots] = useState<ExpressionShot[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [promptMode, setPromptMode] = useState<VideoPromptMode>('shot-list');
  const [gaze, setGaze] = useState<VideoGazeDirection>('right');
  const [perClip, setPerClip] = useState(4);
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

  const remaining = shots?.filter(shot => !shot.done) ?? [];
  const photographed = shots?.filter(shot => shot.done) ?? [];
  const gaps = useMemo(() => (index ? findLibraryGaps(index) : []), [index]);
  const gapMatches = useMemo(() => gaps.filter(g => g.count <= maxPhotos), [gaps, maxPhotos]);
  const videoPrompts = useMemo(() => {
    if (promptMode === 'shot-list') return buildPromptsFromShotList(shots ?? [], gaze, perClip);
    return buildPromptsFromGaps(gaps, gaze, perClip, maxPhotos);
  }, [promptMode, shots, gaps, gaze, perClip, maxPhotos]);

  const group = (title: string, items: ExpressionShot[], initiallyOpen: boolean) => <details className="yt-section expression-shot-group" open={initiallyOpen}>
    <summary>{title} ({items.length})</summary>
    {!items.length && <p className="muted small-text">{initiallyOpen ? 'No shots waiting to be photographed.' : 'No photographed shots yet.'}</p>}
    {items.map(shot => <article className={`expression-shot${shot.done ? ' is-done' : ''}`} key={shot.id}>
      <label><input type="checkbox" checked={shot.done} disabled={!!busy} onChange={e => void setDone(shot, e.target.checked)} /> <strong>{shot.done ? 'Done' : 'To Photograph'}</strong></label>
      <p>{shot.expression}</p>
      {shot.sources.length > 0 && <details><summary>Suggested For ({shot.sources.length})</summary><ul>{shot.sources.map((source, i) => <li key={`${source.piece}-${source.context}-${i}`}>{source.piece.split('/').join(' › ')}{source.context && ` · ${source.context}`}</li>)}</ul></details>}
    </article>)}
  </details>;

  return <section className="expression-shot-list">
    <h2>Expression Shot List</h2>
    <p>Expressions to photograph when you have time. Add suggestions from a video’s Generate Packaging section.</p>
    <p className="muted small-text">Saved in Expression Shot List.json in your Expressions folder.</p>
    {error && <p className="error" role="alert">{error}</p>}

    <details className="yt-section video-prompt-builder" open>
      <summary>AI Video Prompts (Seed With Reference Photo)</summary>
      <p className="muted small-text">
        Google Veo in Gemini generates up to 8 seconds per clip (up to 15 seconds on newer Gemini video models). Putting 4 expressions per clip gives ~2 seconds per pose so you can pause in a video player and save clean, unblurred stills on a neutral grey studio background.
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
            <option value={3}>3 (~6s clip)</option>
            <option value={4}>4 (~8s Veo clip)</option>
            <option value={5}>5 (~10–12s clip)</option>
            <option value={6}>6 (~12–15s clip)</option>
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
          {promptMode === 'shot-list' ? 'No unchecked shots in To Photograph.' : 'No expression categories match that photo count.'}
        </p>
      ) : (
        <div className="video-prompt-list">
          {videoPrompts.map((item, i) => (
            <div className="video-prompt-card" key={i}>
              <div className="video-prompt-head">
                <strong>{item.title}</strong>
                <CopyButton text={item.prompt} label="Copy Prompt" />
              </div>
              <pre className="video-prompt-text">{item.prompt}</pre>
            </div>
          ))}
        </div>
      )}
    </details>

    {!shots && !error && <p className="muted">Loading Shot List…</p>}
    {shots && <>{group('To Photograph', remaining, true)}{group('Photographed', photographed, false)}</>}
  </section>;
}
