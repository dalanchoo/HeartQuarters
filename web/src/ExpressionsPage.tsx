import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  fileUrl,
  getJson,
  getText,
  openInExplorer,
  postJson,
  thumbUrl,
  type ExpressionCategory,
  type ExpressionIndex,
  type ExpressionPhoto,
} from './api';
import { CopyButton } from './PackagingDoc';
import { filterSelectablePhotos, openPhotoSelection, generationCategories, generationCategoryOnSwitch, readReferences, readyCandidateCount, saveReferences, readChosenLikeness, saveChosenLikeness } from './expressionPlanning';
import { CategoryPicker } from './CategoryPicker';
import { emptyPhotoFilters, ExpressionPhotoFilters } from './ExpressionPhotoFilters';
import { ExpressionCandidates, ExpressionGenerator, LikenessPicker } from './ExpressionGenerator';
import { ExpressionShotList } from './ExpressionShotList';
import { ExpressionInbox } from './ExpressionInbox';
import { clampZoom, fitScale, originalSizePercent, snapOriginalSize, zoomAfterResize } from './expressionZoom';
import { isAiExpression, isMotionExpression, matchesExpressionOrigin, matchesMotionFilter } from '../../server/expression-origin';
import { groupExpressionAttributes } from './expressionAttributes';
import { expressionCategoryNames, reviewExpressionFolder, type FolderReviewMode } from './expressionFolderReview';
import { FRAMING_TAGS, MORPHOLOGY_TAGS, POSE_TAGS } from '../../server/expression-attribute-vocabulary';
import { ratingSearchWords } from './expressionRating';

type TagAction = { kind: 'confirm' | 'disconfirm' | 'remove'; tag: ExpressionPhoto['tags'][number]; expression?: boolean } | { kind: 'add'; name: string; group: 'expression' | 'framing' | 'pose' | 'morphology' };

// The selected category is kept in the address: #Expressions/Cognitive/Thinking
function categoryFromHash(): string {
  return decodeURIComponent(location.hash.slice(1).split('/').slice(1).join('/'));
}

function goTo(category: string) {
  location.hash = category ? `#Expressions/${encodeURIComponent(category)}` : '#Expressions';
}

/** A photo matches when every search word appears in its name, category or tags. */
function matches(photo: ExpressionPhoto, searchWords: string[]): boolean {
  const { matches: ratingMatches, rest: words } = ratingSearchWords(photo, searchWords);
  if (!ratingMatches) return false;
  const haystack = [photo.name, photo.category, ...photo.tags.filter(t => !t.disconfirmed).map((t) => t.tag)].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function ExpressionsPage() {
  const [index, setIndex] = useState<ExpressionIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(categoryFromHash);
  const [activeTab, setActiveTab] = useState<'library' | 'generation' | 'shots' | 'inbox'>('library');
  const [generationCategory, setGenerationCategory] = useState('');
  const [readyCount, setReadyCount] = useState<number | null>(null);
  const [includeSub, setIncludeSub] = useState(true);
  const [query, setQuery] = useState('');
  const [photoScope, setPhotoScope] = useState<'all' | 'starred' | 'reference'>('all');
  const [libraryFilters, setLibraryFilters] = useState(emptyPhotoFilters);
  const [reviewFolders, setReviewFolders] = useState<FolderReviewMode | 'all'>('all');
  const [origin, setOrigin] = useState<'all' | 'real' | 'ai'>('all');
  const [motionFilter, setMotionFilter] = useState<'all' | 'motion' | 'still'>('all');
  const [assessmentFilter, setAssessmentFilter] = useState<'all' | 'three-ais' | 'not-three-ais'>('all');
  const [open, setOpen] = useState<string | null>(null); // The photo path stays stable when filters change.
  const [preview, setPreview] = useState<{ photo: ExpressionPhoto; imageUrl?: string } | null>(null);
  const [inbox, setInbox] = useState<ExpressionPhoto[]>([]);
  const refreshInbox = useCallback(() => { void getJson<ExpressionIndex>('/api/expressions').then(setIndex, e => setError(e.message)); void getJson<ExpressionPhoto[]>('/api/expressions/inbox').then(photos => { setInbox(photos); setPreview(current => { if (!current || current.imageUrl || current.photo.category !== '_Inbox') return current; const photo = photos.find(item => item.path === current.photo.path); return photo ? { ...current, photo } : null; }); }, e => setError(e.message)); }, []);
  const [references, setReferences] = useState<string[]>(() => readReferences(localStorage));
  // Reference Photos: the photos that show the AI what John looks like. Separate from the stars.
  const [likeness, setLikeness] = useState<string[]>([]);
  const [likenessBusy, setLikenessBusy] = useState(false);
  // The likeness photos picked last time come back after a reload.
  const [likenessChosen, setLikenessChosen] = useState<string[]>(() => { try { return readChosenLikeness(localStorage); } catch { return []; } });
  const chooseLikeness = (paths: string[]) => { setLikenessChosen(paths); try { saveChosenLikeness(localStorage, paths); } catch { /* only a convenience */ } };
  useEffect(() => { if (index) setLikenessChosen(current => current.filter(path => index.photos.some(photo => photo.path === path))); }, [index]);
  // Photos unmarked while the Library shows only Starred or Reference Photos stay in view until the Photos choice changes.
  const [keptInView, setKeptInView] = useState<string[]>([]);
  const noteUnmarked = (photo: ExpressionPhoto) => setKeptInView(current => current.includes(photo.path) ? current : [...current, photo.path]);
  const [referenceError, setReferenceError] = useState('');
  const [referenceReady, setReferenceReady] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [changeMessage, setChangeMessage] = useState('');
  const [candidateRevision, setCandidateRevision] = useState(0);
  const [assessmentJobs, setAssessmentJobs] = useState<string[]>([]);
  useEffect(() => { if (activeTab === 'inbox') refreshInbox(); }, [activeTab, refreshInbox]);
  useEffect(() => { window.addEventListener('hq-expression-inbox-changed', refreshInbox); return () => window.removeEventListener('hq-expression-inbox-changed', refreshInbox); }, [refreshInbox]);
  const [candidatesWorking, setCandidatesWorking] = useState(false);
  useEffect(() => {
    if (!assessmentJobs.length) return;
    let active = true;
    const check = () => {
      void Promise.all(assessmentJobs.map(id => getJson<{ id: string; state: string }>(`/api/expressions/assessment?id=${encodeURIComponent(id)}`).catch(() => ({ id, state: 'missing' })))).then(jobs => {
        if (!active) return;
        const done = jobs.filter(job => job.state !== 'working');
        if (done.length) {
          setAssessmentJobs(ids => ids.filter(id => !done.some(job => job.id === id)));
          if (done.some(job => job.state === 'done')) { void getJson<ExpressionIndex>('/api/expressions').then(setIndex, e => setError(e.message)); refreshInbox(); }
        }
      });
    };
    const timer = setInterval(check, 3000); return () => { active = false; clearInterval(timer); };
  }, [assessmentJobs]);
  useEffect(() => {
    let active = true;
    const load = () => {
      void getJson<{ state: string }[]>('/api/expression-generation/jobs').then(jobs => {
        if (!active) return;
        setReadyCount(readyCandidateCount(jobs));
        setCandidatesWorking(jobs.some(j => j.state === 'working'));
      }, () => { if (active) { setReadyCount(null); setCandidatesWorking(false); } });
    };
    load();
    if (!candidatesWorking) return () => { active = false; };
    const timer = setInterval(load, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [candidateRevision, candidatesWorking]);
  const changeTag = async (photo: ExpressionPhoto, action: TagAction) => {
    let newPath = photo.path;
    if (action.kind === 'add') await postJson('/api/expressions/add-tag', { photo: photo.path, tag: action.name, group: action.group });
    else if (action.kind === 'confirm' && action.expression) {
      const result = await postJson<{ path: string }>('/api/expressions/confirm-expression', { photo: photo.path, tag: action.tag.tag, confidence: action.tag.confidence });
      newPath = result.path;
    } else await postJson(action.kind === 'confirm' ? '/api/expressions/confirm-tag' : action.kind === 'disconfirm' ? '/api/expressions/disconfirm-tag' : '/api/expressions/remove-tag', { photo: photo.path, tag: action.tag.tag, confidence: action.tag.confidence, confirmed: action.tag.confirmed, disconfirmed: !!action.tag.disconfirmed });
    if (photo.category === '_Inbox') { refreshInbox(); if (newPath !== photo.path) { setPreview(null); setChangeMessage(`Photo filed as ${newPath}.`); void getJson<ExpressionIndex>('/api/expressions').then(setIndex); } return; }
    const [updated, refs] = await Promise.all([getJson<ExpressionIndex>('/api/expressions'), newPath !== photo.path ? getJson<{ paths: string[] }>('/api/expression-references').catch(() => null) : Promise.resolve(null)]);
    setIndex(updated);
    if (newPath !== photo.path) {
      setOpen(current => current === photo.path ? newPath : current);
      setChangeMessage(`Photo moved to ${newPath.split('/').join(' › ')}.`);
      reloadLikeness();
      if (refs) { setReferences(refs.paths); try { saveReferences(localStorage, refs.paths); } catch { /* server copy is authoritative */ } window.dispatchEvent(new Event('hq-starred-photos-changed')); }
      else setReferenceError('The photo moved, but starred photos could not be refreshed. Refresh HeartQuarters to reload them.');
    }
    const refreshed = updated.photos.find(p => p.path === newPath);
    if (refreshed) setPreview(current => current && !current.imageUrl && current.photo.path === photo.path ? { ...current, photo: refreshed } : current);
  };
  // Thumbs up / thumbs down, saved in the photo's sidecar. Clicking the same thumb again clears it.
  const rate = async (photo: ExpressionPhoto, rating: 'liked' | 'disliked' | null) => {
    await postJson('/api/expressions/rating', { photo: photo.path, rating });
    if (photo.category === '_Inbox') { refreshInbox(); return; }
    const updated = await getJson<ExpressionIndex>('/api/expressions');
    setIndex(updated);
    const refreshed = updated.photos.find(p => p.path === photo.path);
    if (refreshed) setPreview(current => current && !current.imageUrl && current.photo.path === photo.path ? { ...current, photo: refreshed } : current);
  };
  const setReference = async (path: string, checked: boolean) => {
    const next = checked ? [...references, path] : references.filter((p) => p !== path);
    setReferenceBusy(true);
    try { await postJson('/api/expression-references', { paths: next }); setReferences(next); window.dispatchEvent(new Event('hq-starred-photos-changed')); try { saveReferences(localStorage, next); } catch { /* The HeartQuarters file is the primary copy. */ } setReferenceError(''); }
    catch { setReferenceError('Could not save starred photos. Your previous selection is still saved.'); }
    finally { setReferenceBusy(false); }
  };

  const setLikenessPhoto = async (path: string, on: boolean) => {
    const next = on ? [...likeness, path] : likeness.filter((p) => p !== path);
    setLikenessBusy(true);
    try { setLikeness((await postJson<{ paths: string[] }>('/api/likeness-references', { paths: next })).paths); setReferenceError(''); }
    catch { setReferenceError('Could not save Reference Photos. Your previous choice is still saved.'); }
    finally { setLikenessBusy(false); }
  };
  const reloadLikeness = useCallback(() => { void getJson<{ paths: string[] }>('/api/likeness-references').then(r => setLikeness(r.paths), () => setReferenceError('Could not load Reference Photos. Refresh HeartQuarters to try again.')); }, []);
  useEffect(() => { reloadLikeness(); }, [reloadLikeness]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let saved = await getJson<{ initialized: boolean; paths: string[] }>('/api/expression-references');
      const browserPaths = readReferences(localStorage);
      if (!saved.initialized && browserPaths.length) saved = await postJson('/api/expression-references', { initialize: true, paths: browserPaths });
      if (active) { setReferences(saved.paths); setReferenceReady(true); }
    };
    void load().catch(() => { if (active) setReferenceError('Could not load starred photos. Your browser selection is still available; refresh to try again.'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    getJson<ExpressionIndex>('/api/expressions').then(setIndex, (e) => setError(e.message));
    // Another tab's address isn't for this page: it stays as it was while hidden.
    const onHash = () => {
      if (!/^#Expressions(\/|$)/.test(location.hash)) return;
      setSelected(categoryFromHash());
      setOpen(null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const byPath = useMemo(
    () => new Map(index?.categories.map((c) => [c.path, c]) ?? []),
    [index],
  );
  const children = useMemo(() => {
    const map = new Map<string, ExpressionCategory[]>();
    for (const c of index?.categories ?? []) {
      if (c.parent === null) continue;
      map.set(c.parent, [...(map.get(c.parent) ?? []), c]);
    }
    return map;
  }, [index]);

  const categoryNames = useMemo(() => expressionCategoryNames(index?.categories ?? []), [index]);
  const current = byPath.get(selected) ?? byPath.get('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    if (!index || !current) return [];
    return filterSelectablePhotos(index.photos, [...(photoScope === 'reference' ? likeness : references), ...keptInView], { scope: photoScope === 'all' ? 'all' : 'starred', category: current.path || '*', includeSub, query: '', attributes: [libraryFilters.framing, libraryFilters.pose, libraryFilters.morphology], textFilters: libraryFilters, rating: libraryFilters.rating }).filter(p => matches(p, words) && matchesExpressionOrigin(p, origin) && matchesMotionFilter(p, motionFilter) && (assessmentFilter === 'all' || (assessmentFilter === 'three-ais' ? !!p.assessedByThreeAIs : !p.assessedByThreeAIs)) && (reviewFolders === 'all' || reviewExpressionFolder(p, categoryNames, reviewFolders) !== null));
  }, [index, current, includeSub, query, origin, motionFilter, assessmentFilter, photoScope, references, likeness, keptInView, libraryFilters, reviewFolders, categoryNames]);

  const { photo: viewedPhoto, index: viewedIndex } = openPhotoSelection(index?.photos ?? [], shown, open);
  // An Inbox photo opened from the Inbox steps through the other Inbox photos.
  const inboxPosition = preview && !preview.imageUrl && preview.photo.category === '_Inbox' && inbox.length > 1 ? inbox.findIndex(p => p.path === preview.photo.path) : -1;

  if (error) return <p className="error content">{error}</p>;
  if (!index || !current) return <p className="muted content">Loading…</p>;

  const crumbs: ExpressionCategory[] = [];
  for (let c: ExpressionCategory | undefined = current; c; c = c.parent === null ? undefined : byPath.get(c.parent)) {
    crumbs.unshift(c);
  }
  const subs = children.get(current.path) ?? [];
  const availableCategories = generationCategories(index.categories);
  const generationSelection = availableCategories.find(c => c.path === generationCategory);
  const switchTab = (tab: 'library' | 'generation' | 'shots' | 'inbox') => {
    if (tab === 'generation' && activeTab !== 'generation') setGenerationCategory(previous => generationCategoryOnSwitch(index.categories, current.path, previous));
    setActiveTab(tab); setOpen(null); setPreview(null);
  };

  return (
    <div className="split">
      <aside className="sidebar" hidden={activeTab !== 'library'}>
        <input
          className="search"
          type="search"
          placeholder="Search tags, e.g. joy frontal"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <CategoryTree path="" childrenOf={children} byPath={byPath} selected={current.path} />
      </aside>

      <section className="content">
        <div className="expression-tabs" role="tablist" aria-label="Expressions views" onKeyDown={e => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return; e.preventDefault(); const tabs = ['library', 'inbox', 'generation', 'shots'] as const; const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[3] : tabs[(tabs.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]; switchTab(next); document.getElementById(`expression-${next}-tab`)?.focus(); }}>
          <button role="tab" aria-selected={activeTab === 'library'} aria-controls="expression-library" id="expression-library-tab" onClick={() => switchTab('library')}>Library</button>
          <button role="tab" aria-selected={activeTab === 'inbox'} aria-controls="expression-inbox" id="expression-inbox-tab" onClick={() => switchTab('inbox')}>Inbox</button>
          <button role="tab" aria-selected={activeTab === 'generation'} aria-controls="expression-generation" id="expression-generation-tab" onClick={() => switchTab('generation')}>Generate &amp; Review{readyCount !== null && readyCount > 0 ? ` · ${readyCount}` : ''}</button>
          <button role="tab" aria-selected={activeTab === 'shots'} aria-controls="expression-shots" id="expression-shots-tab" onClick={() => switchTab('shots')}>Shot List</button>
        </div>
        <div id="expression-inbox" role="tabpanel" aria-labelledby="expression-inbox-tab" hidden={activeTab !== 'inbox'}><ExpressionInbox photos={inbox} onView={photo => setPreview({ photo })} onRefresh={refreshInbox} /></div>
        <div id="expression-shots" role="tabpanel" aria-labelledby="expression-shots-tab" hidden={activeTab !== 'shots'}><ExpressionShotList active={activeTab === 'shots'} index={index} onViewImage={(imageUrl, name, category) => setPreview({ photo: { path: imageUrl, name, category, tags: [] }, imageUrl })} /></div>
        <div id="expression-generation" role="tabpanel" aria-labelledby="expression-generation-tab" hidden={activeTab !== 'generation'}>
        <div className="generation-top">
        <div className="expression-planning">
          <h2>Choose an Expression to Generate</h2>
          <div className="expression-category-picker"><CategoryPicker label="Category" value={generationCategory} options={availableCategories.map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }))} onChange={setGenerationCategory} />
            {generationSelection?.definition && <p>{generationSelection.definition}</p>}
          </div>
        </div>
        <LikenessPicker chosen={likenessChosen} onChoose={chooseLikeness} references={likeness} photos={index.photos} categories={index.categories} starBusy={likenessBusy} onToggleStar={(path, on) => void setLikenessPhoto(path, on)} onViewPhoto={(photo) => setPreview({ photo })} />
        </div>
        {referenceError && <p className="error">{referenceError}</p>}
        {!generationSelection ? <p className="muted">Choose a category to generate an expression.</p> : <ExpressionGenerator category={generationSelection} chosen={likenessChosen} onStarted={() => setCandidateRevision(n => n + 1)} />}
        <ExpressionCandidates categories={index.categories} revision={candidateRevision} onViewCandidate={(id, category) => setPreview({ photo: { path: id, name: 'Generated Candidate', category: category || 'Unassigned', tags: [] }, imageUrl: `/api/expression-generation/image?id=${encodeURIComponent(id)}` })} onSaved={() => { void getJson<ExpressionIndex>('/api/expressions').then(setIndex, (e) => setError(e.message)); setCandidateRevision(n => n + 1); }} />
        </div>
        <div id="expression-library" role="tabpanel" aria-labelledby="expression-library-tab" hidden={activeTab !== 'library'}>
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.path}>
              {i > 0 && <span className="muted"> › </span>}
              <a href="#" onClick={(e) => { e.preventDefault(); goTo(c.path); }}>
                {c.name}
              </a>
            </span>
          ))}
        </div>
        {changeMessage && <p role="status">{changeMessage}</p>}

        <div className="expr-head">
          {current.reference && (
            <button type="button" className="expression-view-image" onClick={() => setPreview({ photo: { path: current.reference!, name: `${current.name} Reference`, category: current.path, tags: [] } })} aria-label={`View ${current.name} reference`}><img className="expr-ref" src={thumbUrl('expressions', current.reference, 240)} alt={`${current.name} reference`} /></button>
          )}
          <div>
            <h1>{current.name}</h1>
            {current.definition && <p className="expr-def">{current.definition}</p>}
            <div className="versions">
              <button className="small" onClick={() => openInExplorer('expressions', current.path)}>
                Open Folder
              </button>
              {subs.length > 0 && (
                <label className="muted small-label">
                  <input type="checkbox" checked={includeSub} onChange={(e) => setIncludeSub(e.target.checked)} />
                  Include sub-expressions
                </label>
              )}
            </div>
          </div>
        </div>
        <div className="generation-photo-filters expression-library-filters">
          <label>Photos <select value={photoScope} onChange={e => { setPhotoScope(e.target.value as 'all' | 'starred' | 'reference'); setKeptInView([]); setOpen(null); }}><option value="all">All Photos</option><option value="starred">Starred Photos</option><option value="reference">Reference Photos</option></select></label>
          <ExpressionPhotoFilters categories={index.categories} filters={{ ...libraryFilters, category: current.path || '*' }} onChange={next => { if (next.category !== (current.path || '*')) goTo(next.category === '*' ? '' : next.category); setLibraryFilters(next); setOpen(null); }} />
          <label>Photo Type <select value={origin} onChange={e => { setOrigin(e.target.value as 'all' | 'real' | 'ai'); setOpen(null); }}><option value="all">All Photos</option><option value="real">Real / Unmarked Photos</option><option value="ai">AI Photos</option></select></label>
          <label>Motion Image <select value={motionFilter} onChange={e => { setMotionFilter(e.target.value as 'all' | 'motion' | 'still'); setOpen(null); }}><option value="all">All Photos</option><option value="motion">Motion Images Only</option><option value="still">Still Photos Only</option></select></label>
          <label>Assessment <select value={assessmentFilter} onChange={e => { setAssessmentFilter(e.target.value as 'all' | 'three-ais' | 'not-three-ais'); setOpen(null); }}><option value="all">All Photos</option><option value="three-ais">Assessed by All Three AIs</option><option value="not-three-ais">Not Assessed by All Three AIs</option></select></label>
        </div>
        <label className="expression-review-filter">Folder Review <select value={reviewFolders} onChange={e => { const value = e.target.value as FolderReviewMode | 'all'; setReviewFolders(value); setOpen(null); if (value !== 'all') goTo(''); }}><option value="all">All Photos</option><option value="missing">Folder Expression Not Among Guesses</option><option value="higher">Another Expression Has a Higher Score</option></select></label>
        {reviewFolders !== 'all' && <p className="muted">{reviewFolders === 'missing' ? 'Shows photos with recorded expression guesses, but none matching the folder. Photos without expression guesses are not included.' : 'Shows photos where the folder expression and another expression have scores, and the other score is higher. Photos without comparable scores are not included.'} Other filters still apply. AI guesses can be wrong.</p>}
        {referenceError && <p className="error">{referenceError}</p>}
        <p className="muted">
          {shown.length} photo{shown.length === 1 ? '' : 's'}
          {words.length > 0 && ` matching “${query.trim()}”`}
        </p>

        <div className="photo-grid">
          {shown.map((p) => (
            <div key={p.path} className="expression-photo-choice"><button className="photo" onClick={() => setOpen(p.path)} title={p.name}>
              <img src={thumbUrl('expressions', p.path, 360, p.revision)} alt={p.name} loading="lazy" />
              <span>{p.rating === 'liked' ? '👍 ' : p.rating === 'disliked' ? '👎 ' : ''}{p.name}</span>
            </button>{reviewFolders !== 'all' && (() => { const review = reviewExpressionFolder(p, categoryNames, reviewFolders); if (!review) return null; const show = (tag: ExpressionPhoto['tags'][number]) => `${tag.tag}${tag.confirmed ? ' (Confirmed)' : tag.confidence !== null ? ` ${tag.confidence}%` : ' (No score)'}`; return <p className="expression-review-reason"><strong>Folder:</strong> {p.category.split('/').join(' › ')}<br /><strong>Folder Guess:</strong> {review.folderTag ? show(review.folderTag) : 'Not recorded'}<br /><strong>Other Guesses:</strong> {review.alternatives.map(show).join(', ')}</p>; })()}<button type="button" disabled={!referenceReady || referenceBusy} aria-pressed={references.includes(p.path)} onClick={() => { if (references.includes(p.path)) noteUnmarked(p); void setReference(p.path, !references.includes(p.path)); }}>{references.includes(p.path) ? '★ Starred' : '☆ Star'}</button><button type="button" disabled={likenessBusy} aria-pressed={likeness.includes(p.path)} title="Reference Photos show the AI what you look like when it generates images of you." onClick={() => { if (likeness.includes(p.path)) noteUnmarked(p); void setLikenessPhoto(p.path, !likeness.includes(p.path)); }}>{likeness.includes(p.path) ? '✓ Reference Photo' : 'Make Reference Photo'}</button>
              <PhotoActions photo={p} rootDir={index.rootDir} categories={index.categories} onChanged={(message) => { setChangeMessage(message); reloadLikeness(); void Promise.all([getJson<ExpressionIndex>('/api/expressions'), getJson<{ paths: string[] }>('/api/expression-references')]).then(([updated, refs]) => { setIndex(updated); setReferences(refs.paths); window.dispatchEvent(new Event('hq-starred-photos-changed')); try { saveReferences(localStorage, refs.paths); } catch { /* server copy is authoritative */ } }, (e) => setError(e.message)); }} />
            </div>
          ))}
        </div>
        </div>
      </section>

      {viewedPhoto && (
        <Lightbox
          photo={viewedPhoto}
          starred={references.includes(viewedPhoto.path)}
          starDisabled={!referenceReady || referenceBusy}
          onToggleStar={() => void setReference(viewedPhoto.path, !references.includes(viewedPhoto.path))}
          reference={likeness.includes(viewedPhoto.path)}
          referenceDisabled={likenessBusy}
          onToggleReference={() => void setLikenessPhoto(viewedPhoto.path, !likeness.includes(viewedPhoto.path))}
          onTagAction={changeTag}
          onRate={rating => rate(viewedPhoto, rating)}
          onAssessmentStarted={id => setAssessmentJobs(ids => [...ids, id])}
          onAssessmentDone={() => { void getJson<ExpressionIndex>('/api/expressions').then(setIndex, (e) => setError(e.message)); }}
          onClose={() => setOpen(null)}
          onPrev={viewedIndex < 0 ? undefined : () => setOpen(shown[(viewedIndex - 1 + shown.length) % shown.length].path)}
          onNext={viewedIndex < 0 ? undefined : () => setOpen(shown[(viewedIndex + 1) % shown.length].path)}
        />
      )}
      {preview && (
        <Lightbox
          key={preview.imageUrl ?? preview.photo.path}
          photo={preview.photo}
          imageUrl={preview.imageUrl}
          starred={!preview.imageUrl && preview.photo.category !== '_Inbox' ? references.includes(preview.photo.path) : undefined}
          starDisabled={!referenceReady || referenceBusy}
          onToggleStar={!preview.imageUrl && preview.photo.category !== '_Inbox' ? () => void setReference(preview.photo.path, !references.includes(preview.photo.path)) : undefined}
          reference={likeness.includes(preview.photo.path)}
          referenceDisabled={likenessBusy}
          onToggleReference={!preview.imageUrl && preview.photo.category !== '_Inbox' ? () => void setLikenessPhoto(preview.photo.path, !likeness.includes(preview.photo.path)) : undefined}
          onTagAction={!preview.imageUrl && (preview.photo.category === '_Inbox' || index.photos.some(p => p.path === preview.photo.path)) ? changeTag : undefined}
          onRate={!preview.imageUrl && (preview.photo.category === '_Inbox' || index.photos.some(p => p.path === preview.photo.path)) ? rating => rate(preview.photo, rating) : undefined}
          onPrev={inboxPosition < 0 ? undefined : () => setPreview({ photo: inbox[(inboxPosition - 1 + inbox.length) % inbox.length] })}
          onNext={inboxPosition < 0 ? undefined : () => setPreview({ photo: inbox[(inboxPosition + 1) % inbox.length] })}
          onAssessmentStarted={id => setAssessmentJobs(ids => [...ids, id])}
          onAssessmentDone={() => { if (preview.photo.category === '_Inbox') refreshInbox(); else void getJson<ExpressionIndex>('/api/expressions').then(updated => { setIndex(updated); setPreview(current => { if (!current || current.imageUrl) return current; const photo = updated.photos.find(p => p.path === current.photo.path); return photo ? { ...current, photo } : current; }); }, e => setError(e.message)); }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function CategoryTree({
  path,
  childrenOf,
  byPath,
  selected,
}: {
  path: string;
  childrenOf: Map<string, ExpressionCategory[]>;
  byPath: Map<string, ExpressionCategory>;
  selected: string;
}) {
  const node = byPath.get(path);
  if (!node) return null;
  const kids = childrenOf.get(path) ?? [];
  const link = (
    <a
      href="#"
      className={`project-link ${path === selected ? 'active' : ''}`}
      onClick={(e) => {
        e.preventDefault();
        goTo(path);
      }}
    >
      <span className="title">{node.name}</span>
      <span className="muted">{node.totalCount}</span>
    </a>
  );
  if (path === '') {
    return (
      <div>
        {link}
        {kids.map((k) => (
          <CategoryTree key={k.path} path={k.path} childrenOf={childrenOf} byPath={byPath} selected={selected} />
        ))}
      </div>
    );
  }
  if (kids.length === 0) return <div className="tree-leaf">{link}</div>;
  const isOpen = selected === path || selected.startsWith(path + '/');
  return (
    <details className="tree-node" open={isOpen}>
      <summary>{link}</summary>
      <div className="tree-children">
        {kids.map((k) => (
          <CategoryTree key={k.path} path={k.path} childrenOf={childrenOf} byPath={byPath} selected={selected} />
        ))}
      </div>
    </details>
  );
}

function PhotoActions({ photo, rootDir, categories, onChanged }: {
  photo: ExpressionPhoto; rootDir: string; categories: ExpressionCategory[]; onChanged: (message: string) => void;
}) {
  type Plan = { token: string; changes: { from: string; to: string | null }[]; sidecars: string[]; links: string[]; references: string[] };
  const [destination, setDestination] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [operation, setOperation] = useState<'delete' | 'move' | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const markAi = async () => {
    setBusy(true); setMessage('');
    try { await postJson('/api/expressions/mark-ai', { photo: photo.path }); onChanged('Photo marked as AI-generated.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not mark the photo.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { setPlan(null); setOperation(null); setDestination(''); setMessage(''); }, [photo.path]);
  const preview = async (kind: 'delete' | 'move') => {
    setBusy(true); setMessage(''); setPlan(null); setOperation(kind);
    try { setPlan(await postJson<Plan>('/api/expressions/preview-change', { photo: photo.path, destination: kind === 'delete' ? null : destination })); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not check this change.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!plan || !operation) return;
    setBusy(true); setMessage('');
    try { await postJson('/api/expressions/apply-change', { photo: photo.path, destination: operation === 'delete' ? null : destination, token: plan.token }); onChanged(operation === 'delete' ? 'Photo moved to HeartQuarters Trash.' : 'Photo moved to the selected category.'); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Could not change the photo.'); setPlan(null); }
    finally { setBusy(false); }
  };
  const fullPath = `${rootDir}\\${photo.path.split('/').join('\\')}`;
  return <div className="expression-actions">
    <div className="expression-action-buttons">
      <CopyButton text={fullPath} label="Copy File Path" />
      <button className="small" onClick={() => openInExplorer('expressions', photo.path)}>Select in Explorer</button>
      {!isAiExpression(photo) && <button className="small" disabled={busy} onClick={() => void markAi()}>Mark as AI</button>}
      <button className="small" disabled={busy} onClick={() => { setOperation(operation === 'move' ? null : 'move'); setPlan(null); setMessage(''); }}>Move</button>
      <button className="small" disabled={busy} onClick={() => void preview('delete')}>Delete</button>
    </div>
    {operation === 'move' && <div className="expression-move"><CategoryPicker label="Move to Category" value={destination} disabled={busy} options={categories.filter(c => c.path && c.path !== photo.category).map(c => ({ value: c.path, label: c.path.split('/').join(' > ') }))} onChange={value => { setDestination(value); setPlan(null); }} /><button className="small" disabled={!destination || busy} onClick={() => void preview('move')}>Review Move</button></div>}
    {message && <p className="error">{message}</p>}
    {plan && <div className="expression-review"><p><strong>Review Changes</strong></p><ul>{plan.changes.map(c => <li key={c.from}>{c.from} → {c.to ?? 'HeartQuarters Trash'}</li>)}</ul><p>{plan.sidecars.length} photo and sidecar files will move. {plan.links.length} thumbnail references and {plan.references.length} saved reference photos will be updated.</p><details><summary>Files and Thumbnail References</summary><ul>{plan.sidecars.map(f => <li key={f}>{f}</li>)}{plan.links.map(f => <li key={f}>Thumbnail: {f}</li>)}</ul></details>{operation === 'delete' && plan.links.length > 0 && <p>Thumbnail projects using the deleted photo will keep a copy in their Drafts Source folder.</p>}<button disabled={busy} onClick={() => void apply()}>{operation === 'delete' ? 'Delete Photo' : 'Move Photo'}</button>{' '}<button disabled={busy} onClick={() => { setPlan(null); setOperation(null); }}>Cancel</button></div>}
  </div>;
}

function Lightbox({ photo, imageUrl, starred, starDisabled, onToggleStar, reference, referenceDisabled, onToggleReference, onClose, onPrev, onNext, onTagAction, onRate, onAssessmentStarted, onAssessmentDone }: {
  photo: ExpressionPhoto; imageUrl?: string; starred?: boolean; starDisabled?: boolean; onToggleStar?: () => void; reference?: boolean; referenceDisabled?: boolean; onToggleReference?: () => void; onClose: () => void; onPrev?: () => void; onNext?: () => void; onTagAction?: (photo: ExpressionPhoto, action: TagAction) => Promise<void>; onRate?: (rating: 'liked' | 'disliked' | null) => Promise<void>; onAssessmentStarted?: (id: string) => void; onAssessmentDone?: () => void;
}) {
  const [pendingTag, setPendingTag] = useState<Extract<TagAction, { tag: ExpressionPhoto['tags'][number] }> | null>(null);
  const [savingTag, setSavingTag] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const saveRating = async (rating: 'liked' | 'disliked') => {
    if (!onRate) return;
    setRatingBusy(true); setConfirmError('');
    try { await onRate(photo.rating === rating ? null : rating); }
    catch (e) { setConfirmError(e instanceof Error ? e.message : String(e)); }
    finally { setRatingBusy(false); }
  };
  const [assessmentId, setAssessmentId] = useState(''); const [assessmentMessage, setAssessmentMessage] = useState(''); const [assessmentBusy, setAssessmentBusy] = useState(false);
  useEffect(() => { setAssessmentId(''); setAssessmentMessage(''); setAssessmentBusy(false); }, [photo.path]);
  useEffect(() => {
    if (!assessmentId) return;
    let alive = true;
    const check = async () => { try { const job = await getJson<{ state: 'working' | 'done' | 'failed'; error?: string; models: Record<'claude' | 'codex' | 'gemini', string> }>(`/api/expressions/assessment?id=${encodeURIComponent(assessmentId)}`); if (!alive) return; if (job.state === 'working') { setAssessmentMessage(`Assessing: Claude ${job.models.claude}, ChatGPT ${job.models.codex}, Gemini ${job.models.gemini}.`); return; } setAssessmentId(''); setAssessmentBusy(false); if (job.state === 'done') { setAssessmentMessage('All three assessments are complete. Unconfirmed guesses below 75% were omitted; confirmed and disconfirmed attributes were kept.'); onAssessmentDone?.(); } else setAssessmentMessage(job.error ?? 'Assessment failed.'); } catch (e) { if (alive) { setAssessmentId(''); setAssessmentBusy(false); setAssessmentMessage(e instanceof Error ? e.message : String(e)); } } };
    void check(); const timer = setInterval(() => void check(), 3000); return () => { alive = false; clearInterval(timer); };
  }, [assessmentId]);
  const assess = async () => { setAssessmentBusy(true); setAssessmentMessage('Preparing a blind assessment…'); try { const job = await postJson<{ id: string }>('/api/expressions/assess', { photo: photo.path }); setAssessmentId(job.id); onAssessmentStarted?.(job.id); setAssessmentMessage('Assessing photo… You can leave this view while it runs.'); } catch (e) { setAssessmentBusy(false); setAssessmentMessage(e instanceof Error ? e.message : String(e)); } };

  const [newFraming, setNewFraming] = useState('');
  const [newPose, setNewPose] = useState('');
  const [newMorphology, setNewMorphology] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const center = useRef<{ x: number; y: number } | null>(null);
  const fit = fitScale(imageSize.width, imageSize.height, viewSize.width, viewSize.height);
  const viewerSize = useRef({ fit, zoom, imageSize, viewSize });
  viewerSize.current = { fit, zoom, imageSize, viewSize };
  const maximum = 2 / fit;
  const percent = originalSizePercent(fit, zoom);
  const changeZoom = (next: number | ((previous: number) => number)) => {
    const el = viewport.current;
    if (el) center.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setZoom(previous => clampZoom(typeof next === 'function' ? next(previous) : next, maximum));
  };
  useEffect(() => { setZoom(1); setImageSize({ width: 0, height: 0 }); setConfirmError(''); setPendingTag(null); setNewFraming(''); setNewPose(''); setNewMorphology(''); center.current = null; }, [photo.path]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      const previous = viewerSize.current;
      if (next.width === previous.viewSize.width && next.height === previous.viewSize.height) return;
      if (previous.imageSize.width && next.width && next.height) {
        const nextFit = fitScale(previous.imageSize.width, previous.imageSize.height, next.width, next.height);
        setZoom(zoomAfterResize(previous.fit, previous.zoom, nextFit));
      }
      setViewSize(next);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    document.body.classList.add('expression-viewer-open');
    return () => document.body.classList.remove('expression-viewer-open');
  }, []);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const target = center.current ?? { x: 0.5, y: 0.5 };
    el.scrollLeft = target.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = target.y * el.scrollHeight - el.clientHeight / 2;
    center.current = null;
  }, [zoom, imageSize, viewSize]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); changeZoom(previous => previous * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [maximum]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (pendingTag) setPendingTag(null); else onClose(); return; }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft') onPrev?.();
      if (e.key === 'ArrowRight') onNext?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext, pendingTag]);

  const groups = groupExpressionAttributes(photo.tags);
  const saveTag = async (action: TagAction) => {
    if (!onTagAction) return;
    setSavingTag(true); setConfirmError('');
    try { await onTagAction(photo, action); setPendingTag(null); setNewFraming(''); setNewPose(''); setNewMorphology(''); }
    catch (e) { setConfirmError(e instanceof Error ? e.message : String(e)); }
    finally { setSavingTag(false); }
  };
  const showTags = (tags: ExpressionPhoto['tags'], expression = false) => <><div className="chips">{tags.map(t => <span key={t.tag} className={`attribute-chip${t.confirmed ? ' confirmed' : t.disconfirmed ? ' disconfirmed' : ''}`}>
    <span title={t.confirmed ? 'Confirmed' : t.disconfirmed ? 'Disconfirmed' : 'AI suggestion'}>{t.tag}{t.disconfirmed && ' · Disconfirmed'}{!t.confirmed && !t.disconfirmed && !t.assessments && t.confidence !== null && ` ${t.confidence}%`}</span>{t.assessments && <span className="attribute-assessments">{([['claude', 'Claude'], ['codex', 'ChatGPT'], ['gemini', 'Gemini']] as const).filter(([id]) => t.assessments?.[id] !== undefined).map(([id, name]) => `${name} ${t.assessments?.[id]}%`).join(' · ')}</span>}
    {onTagAction && <>{!t.confirmed && <button type="button" disabled={savingTag} onClick={() => void saveTag({ kind: 'confirm', tag: t, expression })}>Confirm</button>}{!t.disconfirmed && <button type="button" disabled={savingTag} onClick={() => void saveTag({ kind: 'disconfirm', tag: t })}>Disconfirm</button>}<button type="button" disabled={savingTag} onClick={() => setPendingTag({ kind: 'remove', tag: t })} aria-label={`Remove ${t.tag}`}>×</button></>}
  </span>)}</div>{pendingTag && tags.some(t => t.tag === pendingTag.tag.tag) && <div className="attribute-confirmation" role="alertdialog" aria-label={`${pendingTag.kind === 'confirm' ? 'Confirm' : 'Remove'} ${pendingTag.tag.tag}`}><p>{pendingTag.kind === 'confirm' ? `Confirm that ${pendingTag.tag.tag} applies to this photo?` : `Remove ${pendingTag.tag.tag} from this photo?`}</p><div className="attribute-confirmation-buttons"><button disabled={savingTag} onClick={() => void saveTag(pendingTag)}>{pendingTag.kind === 'confirm' ? 'Confirm Attribute' : 'Remove Attribute'}</button><button disabled={savingTag} onClick={() => setPendingTag(null)}>Cancel</button></div></div>}</>;

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        {onPrev && <button className="lb-nav lb-prev" onClick={onPrev} title="Previous (←)">‹</button>}
        {/* Preview first, swapped for the full-size photo once it has loaded. */}
        <div ref={viewport} className={`lb-viewport${zoom > 1 ? ' zoomed' : ''}`}
          onPointerDown={(e) => { if (zoom <= 1 || e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (d.moved) { e.currentTarget.scrollLeft = d.left - dx; e.currentTarget.scrollTop = d.top - dy; } }}
          onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } changeZoom(zoom > 1 ? 1 : fit < 1 ? 1 / fit : 2); }}>
          <div className="lb-image-canvas" style={{ width: Math.max(viewSize.width, imageSize.width * fit * zoom), height: Math.max(viewSize.height, imageSize.height * fit * zoom) }}>
            <img className="lb-img" src={imageUrl ?? fileUrl('expressions', photo.path, photo.revision)} style={{ width: imageSize.width ? imageSize.width * fit * zoom : undefined, height: imageSize.height ? imageSize.height * fit * zoom : undefined, backgroundImage: imageUrl ? undefined : `url("${thumbUrl('expressions', photo.path, 800, photo.revision)}")` }} alt={photo.name}
              onLoad={(e) => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              role="button" tabIndex={0} aria-label={zoom > 1 ? 'Return photo to fit' : 'View photo at full size'} draggable={false}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); changeZoom(zoom > 1 ? 1 : fit < 1 ? 1 / fit : 2); } }} />
          </div>
        </div>
        {onNext && <button className="lb-nav lb-next" onClick={onNext} title="Next (→)">›</button>}
        <div className={`lb-info${detailsExpanded ? '' : ' is-collapsed'}`}>
          <div className="lb-details">
          <div className="lb-title">
            <div className="lb-title-name">
              {onToggleStar && (
                <button
                  type="button"
                  className={`lb-star${starred ? ' is-starred' : ''}`}
                  disabled={starDisabled}
                  aria-pressed={!!starred}
                  aria-label={starred ? 'Remove from Favorites' : 'Add to Favorites'}
                  title={starred ? 'Remove from Favorites' : 'Add to Favorites'}
                  onClick={onToggleStar}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      d="M12 2.5l2.93 5.94 6.56.95-4.74 4.62 1.12 6.53L12 17.45l-5.87 3.09 1.12-6.53L2.51 9.39l6.56-.95L12 2.5z"
                      fill={starred ? '#facc15' : 'none'}
                      stroke={starred ? '#b45309' : 'currentColor'}
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
              {onRate && <span className="lb-rating" role="group" aria-label="Rating">
                <button type="button" className={`lb-thumb${photo.rating === 'liked' ? ' is-liked' : ''}`} disabled={ratingBusy} aria-pressed={photo.rating === 'liked'} title={photo.rating === 'liked' ? 'Liked (click to clear)' : 'I Like This Photo'} onClick={() => void saveRating('liked')}><ThumbIcon /></button>
                <button type="button" className={`lb-thumb${photo.rating === 'disliked' ? ' is-disliked' : ''}`} disabled={ratingBusy} aria-pressed={photo.rating === 'disliked'} title={photo.rating === 'disliked' ? 'Disliked (click to clear)' : "I Don't Like This Photo"} onClick={() => void saveRating('disliked')}><ThumbIcon down /></button>
              </span>}
              <strong>{photo.name}</strong>
              <span className="muted">{photo.category.split('/').join(' › ')}</span>
              {onToggleReference && <button type="button" className="small" disabled={referenceDisabled} aria-pressed={!!reference} title="Reference Photos show the AI what you look like when it generates images of you." onClick={onToggleReference}>{reference ? '✓ Reference Photo' : 'Make Reference Photo'}</button>}
            </div>
            {detailsExpanded && onTagAction && <button className="expression-assess" type="button" disabled={assessmentBusy || savingTag} onClick={() => void assess()}>Reassess With All Three AIs</button>}
            {detailsExpanded && !imageUrl && <button type="button" className="small" onClick={() => void openInExplorer('expressions', photo.path)}>Select in Explorer</button>}
            {(onPrev || onNext) && <span className="lb-step"><button type="button" className="small" disabled={!onPrev} onClick={onPrev} title="Previous Photo (←)">‹ Previous</button><button type="button" className="small" disabled={!onNext} onClick={onNext} title="Next Photo (→)">Next ›</button></span>}
            <button type="button" aria-expanded={detailsExpanded} aria-controls="expression-photo-details" onClick={() => { const el = viewport.current; if (el) center.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight }; setDetailsExpanded(open => !open); }}>{detailsExpanded ? 'Hide Details' : 'Show Details'}</button>
          </div>
          <div id="expression-photo-details" hidden={!detailsExpanded}>
          {assessmentMessage && <p role="status">{assessmentMessage}</p>}
          {groups.details.length > 0 && showTags(groups.details)}
          <div className="attribute-groups">
            <div className="attribute-row"><section><AttributeDefinitions title="Framing" file="Framing.txt" />{groups.framing.length ? showTags(groups.framing) : <p className="muted small-text">None recorded.</p>}</section>
              {onTagAction && <div className="lb-attribute-control"><CategoryPicker label="Add Framing" value={newFraming} disabled={savingTag} onChange={setNewFraming} placeholder="Choose…" searchPlaceholder="Search framing…" emptyMessage="No matching attributes." options={FRAMING_TAGS.filter(name => !photo.tags.some(t => t.tag.toLowerCase() === name.toLowerCase())).map(name => ({ value: name, label: name.replace(/([a-z])([A-Z])/g, '$1 $2') }))} /><button aria-label="Add framing" disabled={savingTag || !newFraming} onClick={() => void saveTag({ kind: 'add', name: newFraming, group: 'framing' })}>Add</button></div>}</div>
            <div className="attribute-row"><section><AttributeDefinitions title="Pose & Gaze" file="PoseGaze.txt" />{groups.pose.length ? showTags(groups.pose) : <p className="muted small-text">None recorded.</p>}</section>
              {onTagAction && <div className="lb-attribute-control"><CategoryPicker label="Add Pose" value={newPose} disabled={savingTag} onChange={setNewPose} placeholder="Choose…" searchPlaceholder="Search pose…" emptyMessage="No matching attributes." options={POSE_TAGS.filter(name => !photo.tags.some(t => t.tag.toLowerCase() === name.toLowerCase())).map(name => ({ value: name, label: name.replace(/([a-z])([A-Z])/g, '$1 $2') }))} /><button aria-label="Add pose" disabled={savingTag || !newPose} onClick={() => void saveTag({ kind: 'add', name: newPose, group: 'pose' })}>Add</button></div>}</div>
            <div className="attribute-row"><section><AttributeDefinitions title="Morphology" file="Morphology.txt" />{groups.morphology.length ? showTags(groups.morphology) : <p className="muted small-text">None recorded.</p>}</section>
              {onTagAction && <div className="lb-attribute-control"><CategoryPicker label="Add Morphology" value={newMorphology} disabled={savingTag} onChange={setNewMorphology} placeholder="Choose…" searchPlaceholder="Search morphology…" emptyMessage="No matching attributes." options={MORPHOLOGY_TAGS.filter(name => !photo.tags.some(t => t.tag.toLowerCase() === name.toLowerCase())).map(name => ({ value: name, label: name.replace(/([a-z])([A-Z])/g, '$1 $2') }))} /><button aria-label="Add morphology" disabled={savingTag || !newMorphology} onClick={() => void saveTag({ kind: 'add', name: newMorphology, group: 'morphology' })}>Add</button></div>}</div>
            <section><h4>Expressions</h4>{groups.expressions.length ? showTags(groups.expressions, true) : <p className="muted small-text">None recorded.</p>}
            </section>
          </div>
          {confirmError && <p className="error">{confirmError}</p>}
          <p className="muted small-text">Use the mouse wheel or slider to zoom, and drag to pan. Click the photo to switch between fit and full size.</p>
          </div>
          </div>
          <div className="lb-zoom"><label htmlFor="expression-zoom">Zoom</label><div className="lb-zoom-track"><input id="expression-zoom" type="range" min={originalSizePercent(fit, 1)} max="200" step="any" value={percent} onChange={(e) => changeZoom(snapOriginalSize(Number(e.target.value)) / (fit * 100))} /><button type="button" className="lb-zoom-original" style={{ top: `calc(${10000 / (200 - originalSizePercent(fit, 1))}% + ${8 - 1600 / (200 - originalSizePercent(fit, 1))}px)` }} onClick={() => changeZoom(1 / fit)} aria-label="Set zoom to 100%">100%</button></div><span>{percent < 10 ? percent.toFixed(1) : Math.round(percent)}%</span></div>
          <button type="button" className="lb-close" onClick={onClose} aria-label="Close photo viewer" title="Close (Esc)">×</button>
        </div>
      </div>
    </div>
  );
}

/** An outlined thumb in the same style as the star; it fills in when chosen (colour comes from the CSS). */
function ThumbIcon({ down = false }: { down?: boolean }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
    <path d="M7 10v12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" fill="var(--thumb-fill, none)" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>;
}

/** Show the current library reference without leaving the photo viewer. */
function AttributeDefinitions({ title, file }: { title: string; file: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    setText(null); setError('');
    void getText('expressions', file).then(value => { if (active) setText(value); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [open, file]);
  return <><div className="attribute-heading"><h4>{title}</h4><button type="button" aria-label={`${open ? 'Hide' : 'View'} ${title} Definitions`} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide Definitions' : 'View Definitions'}</button></div>
    {open && <div className="attribute-definitions" aria-label={`${title} Definitions`}>
      <strong>{title} Definitions</strong>
      {error ? <p role="alert">Could not load {file}: {error}</p> : text === null ? <p>Loading definitions…</p> : text ? <pre>{text}</pre> : <p>This file is empty.</p>}
    </div>}
  </>;
}
