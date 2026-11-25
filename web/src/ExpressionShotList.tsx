import { useEffect, useState } from 'react';
import { getJson, postJson, type ExpressionIndex } from './api';
import type { ExpressionShot } from '../../server/expression-shot-list';
import type { ShotReference } from '../../server/shot-reference';
import type { Tag } from '../../server/expressions';
import { ExpressionVideos } from './ExpressionVideos';
import { AiSelect, IMAGE_AIS, aiName, useAiFor } from './AiChoice';
import { byNeed, coverageText, folderCoverage, isWellCovered, WELL_COVERED } from './shotCoverage';

export function ExpressionShotList({ active, index, onViewImage }: { active: boolean; index: ExpressionIndex | null; onViewImage: (imageUrl: string, name: string, category: string, tags: Tag[]) => void }) {
  const [shots, setShots] = useState<ExpressionShot[] | null>(null);
  const [pictures, setPictures] = useState<Record<string, ShotReference>>({});
  // The picture John picked for each shot; a newly made picture takes over again.
  const [chosen, setChosen] = useState<Record<string, { name: string; count: number }>>({});
  // What the last Move to Expression Inbox did, per look.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  // Which AI makes reference pictures: any that can make images. Remembered in this browser.
  const [imageAi, setImageAi] = useAiFor('shot-picture', 'codex', IMAGE_AIS);
  // Merge Duplicates: which AI compares the looks in each folder. Remembered in this browser.
  const [mergeAi, setMergeAi] = useAiFor('shot-list-merge');
  const [merging, setMerging] = useState(false);
  const [mergeMessage, setMergeMessage] = useState('');
  const mergeDuplicates = async () => {
    setMerging(true); setError(''); setMergeMessage('');
    try {
      const result = await postJson<{ shots: ExpressionShot[]; merged: number; copy?: string }>('/api/expressions/shot-list/merge', { ai: mergeAi });
      setShots(result.shots);
      setMergeMessage(result.merged ? `Merged ${result.merged} duplicate ${result.merged === 1 ? 'look' : 'looks'}; their wording and pictures are kept on the look that stays. The list as it was is saved as ${result.copy}.` : 'No duplicates found.');
      window.dispatchEvent(new Event('hq-expression-shot-list-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setMerging(false); }
  };

  useEffect(() => {
    if (!active) return;
    let activeRequest = true;
    const load = () => { void getJson<ExpressionShot[]>('/api/expressions/shot-list').then(value => { if (activeRequest) { setShots(value); setError(''); } }, (e: Error) => { if (activeRequest) setError(e.message); }); };
    load(); window.addEventListener('hq-expression-shot-list-changed', load);
    return () => { activeRequest = false; window.removeEventListener('hq-expression-shot-list-changed', load); };
  }, [active]);

  const making = Object.values(pictures).some(p => p.state === 'working');
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () => { void getJson<Record<string, ShotReference>>('/api/expressions/shot-list/references').then(value => { if (live) setPictures(value); }, (e: Error) => { if (live) setError(e.message); }); };
    load(); window.addEventListener('hq-expression-shot-list-changed', load); // merged looks bring their pictures
    // While a picture is being made, check every few seconds so it appears when ready.
    const timer = making ? setInterval(load, 3000) : undefined;
    return () => { live = false; if (timer) clearInterval(timer); window.removeEventListener('hq-expression-shot-list-changed', load); };
  }, [active, making]);

  const makePicture = async (shot: ExpressionShot) => {
    setError('');
    try { const job = await postJson<ShotReference>('/api/expressions/shot-list/reference/start', { id: shot.id, ai: imageAi }); setPictures(current => ({ ...current, [shot.id]: job })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  /** The picture leaves the look for the Inbox. The look stays where it is: John moves it to Photographed himself. */
  const moveToInbox = async (shot: ExpressionShot, name: string) => {
    setBusy(shot.id); setError('');
    try {
      const result = await postJson<{ path: string; pictures: ShotReference | null }>('/api/expressions/shot-list/reference/move-to-inbox', { id: shot.id, name });
      setPictures(current => { const next = { ...current }; if (result.pictures) next[shot.id] = result.pictures; else delete next[shot.id]; return next; });
      setMoved(current => ({ ...current, [shot.id]: `Moved to the Expression Inbox: ${result.path}` }));
      window.dispatchEvent(new Event('hq-expression-inbox-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  /** Delete Picture: only the picture shown goes to HeartQuarters Trash; the look and its other pictures stay. */
  const deletePicture = async (shot: ExpressionShot, name: string) => {
    setBusy(shot.id); setError('');
    try {
      const job = await postJson<ShotReference | null>('/api/expressions/shot-list/reference/delete', { id: shot.id, name });
      setPictures(current => { const next = { ...current }; if (job) next[shot.id] = job; else delete next[shot.id]; return next; });
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const setDone = async (shot: ExpressionShot, done: boolean) => {
    setBusy(shot.id); setError('');
    try { setShots(await postJson<ExpressionShot[]>('/api/expressions/shot-list/status', { id: shot.id, done })); window.dispatchEvent(new Event('hq-expression-shot-list-changed')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const remove = async (shot: ExpressionShot) => {
    if (!window.confirm(`Delete the look “${shot.title || shot.description}” from the Shot List? Its AI pictures go to HeartQuarters Trash.`)) return;
    setBusy(shot.id); setError('');
    try { setShots(await postJson<ExpressionShot[]>('/api/expressions/shot-list/delete', { id: shot.id })); window.dispatchEvent(new Event('hq-expression-shot-list-changed')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const remaining = shots?.filter(shot => !shot.done) ?? [];
  const photographed = shots?.filter(shot => shot.done) ?? [];

  const known = new Set(index?.categories.map(c => c.path) ?? []);
  const folderLabel = (path: string) => path ? path.split('/').join(' > ') : 'Not Yet Sorted';
  const card = (shot: ExpressionShot) => {
    const tags = ([['Framing', shot.framing], ['Pose', shot.pose], ['Morphology', shot.morphology]] as const).filter(([, list]) => list.length);
    const picture = pictures[shot.id];
    const list = picture?.pictures ?? [];
    const pick = chosen[shot.id]?.count === list.length && list.includes(chosen[shot.id].name) ? chosen[shot.id].name : list[0];
    const pictureUrl = pick ? `/api/expressions/shot-list/reference/image?id=${encodeURIComponent(shot.id)}&name=${encodeURIComponent(pick)}` : '';
    const pictureLabel = (name: string) => `AI ${String(list.length - list.indexOf(name)).padStart(2, '0')}${name === list[0] ? ' (Newest)' : ''}`;
    const name = shot.title || shot.description || 'Untitled Shot';
    return <details className="expression-shot" key={shot.id}>
      <summary><strong>{name}</strong></summary>
      <div className="expression-shot-body">
        <div>
          {shot.title && <p>{shot.description || <span className="muted">No description yet.</span>}</p>}
          {tags.length > 0 && <p className="expression-shot-tags">{tags.map(([label, list]) => <span key={label}><strong>{label}:</strong> {list.join(', ')}</span>)}</p>}
          {shot.alsoFits.length > 0 && <p className="muted small-text">Also Fits: {shot.alsoFits.map(folderLabel).join(', ')}</p>}
          <div className="expression-shot-actions">
            {!shot.done && picture?.state !== 'working' && <AiSelect value={imageAi} onChange={setImageAi} only={IMAGE_AIS} title="Which AI makes the picture" />}
            {!shot.done && <button className="small" disabled={!known.has(shot.category) || picture?.state === 'working'} title={known.has(shot.category) ? undefined : 'Sort this shot into an expression folder first.'} onClick={() => void makePicture(shot)}>{picture?.state === 'working' ? 'Generating…' : pictureUrl ? 'Generate Another' : 'Generate Reference With AI'}</button>}
            <button className="small" disabled={!!busy} onClick={() => void setDone(shot, !shot.done)}>{shot.done ? 'Move Back to To Photograph' : 'Move to Photographed'}</button>
            <button className="small" disabled={!!busy} onClick={() => void remove(shot)} title="Removes this whole look from the Shot List; its AI pictures go to HeartQuarters Trash">Delete Look</button>
          </div>
          {picture?.state === 'working' && <p className="muted small-text" role="status">{aiName(picture.ai ?? 'codex')} is making the picture. This can take a few minutes.</p>}
          {picture?.state === 'failed' && <p className="error small-text">{picture.error}</p>}
          {moved[shot.id] && <p className="muted small-text" role="status">{moved[shot.id]}</p>}
        </div>
        {pictureUrl && <div className="expression-shot-pictures">
          <button type="button" className="expression-view-image expression-shot-picture" onClick={() => onViewImage(pictureUrl, `${name} · ${pictureLabel(pick)}`, shot.category, picture?.tags?.[pick] ?? [])} aria-label={`View the AI reference for ${name}`}><img src={pictureUrl} alt={`AI reference for ${name}`} loading="lazy" /></button>
          {list.length > 1 && <select aria-label="Choose a picture" value={pick} onChange={e => setChosen(current => ({ ...current, [shot.id]: { name: e.target.value, count: list.length } }))}>{list.map(item => <option key={item} value={item}>{pictureLabel(item)}</option>)}</select>}
          <button className="small" disabled={!!busy || picture?.state === 'working'} onClick={() => void moveToInbox(shot, pick)} title="Moves this picture to the Expression Inbox; the look keeps its other pictures">Move to Expression Inbox</button>
          <button className="small" disabled={!!busy || picture?.state === 'working'} onClick={() => void deletePicture(shot, pick)} title="Moves only this picture to HeartQuarters Trash">Delete Picture</button>
        </div>}
      </div>
    </details>;
  };
  /** One top-level section, with its shots grouped into collapsible expression folders. */
  const section = (title: string, items: ExpressionShot[], open: boolean, empty: string) => {
    const byFolder = new Map<string, ExpressionShot[]>();
    for (const shot of items) byFolder.set(shot.category, [...(byFolder.get(shot.category) ?? []), shot]);
    // Neediest first: the folders with the fewest Liked photos in the library.
    const coverage = (folder: string) => folderCoverage(index?.photos ?? [], folder);
    const folders = byNeed([...byFolder.keys()], coverage);
    return <details className="yt-section expression-shot-group" open={open}><summary>{title} ({items.length})</summary>
      {!items.length && <p className="muted small-text">{empty}</p>}
      {folders.map(folder => <details className="yt-section expression-shot-group" key={folder || 'unsorted'}>
        <summary className={folder && isWellCovered(coverage(folder)) ? 'muted' : undefined}>{folderLabel(folder)} ({byFolder.get(folder)!.length}){folder && index && <span className="muted small-text"> · In library: {coverageText(coverage(folder))}{isWellCovered(coverage(folder)) ? ' · Well covered' : ''}</span>}</summary>
        {byFolder.get(folder)!.map(card)}
      </details>)}
    </details>;
  };

  return <section className="expression-shot-list">
    <h2>Expression Shot List</h2>
    <p>Expressions to photograph when you have time. Every expression a video’s packaging brief suggests is added here by itself, and a look already on the list is merged into it.</p>
    <p className="muted small-text">Folders needing photos most come first. Counts are the library's Liked and Meh photos (Disliked and unrated ones don't count); from {WELL_COVERED} Liked a folder is well covered and greyed. Saved in Expression Shot List.json in your Expressions folder.</p>
    <div className="expression-inbox-actions">
      <button disabled={merging || !shots?.length} onClick={() => void mergeDuplicates()} title="An AI compares the looks in each expression folder and merges the ones that would be the same photo">{merging ? 'Merging Duplicates…' : 'Merge Duplicates'}</button>
      <AiSelect value={mergeAi} onChange={setMergeAi} title="Which AI finds the duplicates" />
    </div>
    {mergeMessage && <p role="status">{mergeMessage}</p>}
    {error && <p className="error" role="alert">{error}</p>}

    {!shots && !error && <p className="muted">Loading Shot List…</p>}
    {shots && <section className="expression-shot-groups">
      {section('To Photograph', remaining, true, 'No shots waiting to be photographed.')}
      {section('Photographed', photographed, false, 'No photographed shots yet.')}
    </section>}

    <ExpressionVideos active={active} index={index} />
  </section>;
}
