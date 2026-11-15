import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  fileUrl,
  getJson,
  openInExplorer,
  postJson,
  thumbUrl,
  type ExpressionCategory,
  type ExpressionIndex,
  type ExpressionPhoto,
} from './api';
import { CopyButton } from './PackagingDoc';
import { readReferences, saveReferences, suggestedCategories } from './expressionPlanning';
import { ExpressionGenerator } from './ExpressionGenerator';
import { clampZoom, fitScale } from './expressionZoom';

// The selected category is kept in the address: #Expressions/Cognitive/Thinking
function categoryFromHash(): string {
  return decodeURIComponent(location.hash.slice(1).split('/').slice(1).join('/'));
}

function goTo(category: string) {
  location.hash = category ? `#Expressions/${encodeURIComponent(category)}` : '#Expressions';
}

/** A photo matches when every search word appears in its name, category or tags. */
function matches(photo: ExpressionPhoto, words: string[]): boolean {
  const haystack = [photo.name, photo.category, ...photo.tags.map((t) => t.tag)].join(' ').toLowerCase();
  return words.every((w) => haystack.includes(w));
}

export function ExpressionsPage() {
  const [index, setIndex] = useState<ExpressionIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(categoryFromHash);
  const [includeSub, setIncludeSub] = useState(true);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<number | null>(null); // index into `shown`
  const [references, setReferences] = useState<string[]>(() => readReferences(localStorage));
  const [referenceError, setReferenceError] = useState('');
  const [referenceReady, setReferenceReady] = useState(false);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [changeMessage, setChangeMessage] = useState('');
  const setReference = async (path: string, checked: boolean) => {
    const next = checked ? [...references, path] : references.filter((p) => p !== path);
    setReferenceBusy(true);
    try { await postJson('/api/expression-references', { paths: next }); setReferences(next); try { saveReferences(localStorage, next); } catch { /* The HeartQuarters file is the primary copy. */ } setReferenceError(''); }
    catch { setReferenceError('Could not save reference photos. Your previous selection is still saved.'); }
    finally { setReferenceBusy(false); }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      let saved = await getJson<{ initialized: boolean; paths: string[] }>('/api/expression-references');
      const browserPaths = readReferences(localStorage);
      if (!saved.initialized && browserPaths.length) saved = await postJson('/api/expression-references', { initialize: true, paths: browserPaths });
      if (active) { setReferences(saved.paths); setReferenceReady(true); }
    };
    void load().catch(() => { if (active) setReferenceError('Could not load saved references. Your browser selection is still available; refresh to try again.'); });
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

  const current = byPath.get(selected) ?? byPath.get('');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => {
    if (!index || !current) return [];
    const inScope = (p: ExpressionPhoto) =>
      current.path === '' ||
      p.category === current.path ||
      (includeSub && p.category.startsWith(current.path + '/'));
    return index.photos.filter((p) => inScope(p) && matches(p, words));
  }, [index, current, includeSub, query]);

  if (error) return <p className="error content">{error}</p>;
  if (!index || !current) return <p className="muted content">Loading…</p>;

  const crumbs: ExpressionCategory[] = [];
  for (let c: ExpressionCategory | undefined = current; c; c = c.parent === null ? undefined : byPath.get(c.parent)) {
    crumbs.unshift(c);
  }
  const subs = children.get(current.path) ?? [];

  return (
    <div className="split">
      <aside className="sidebar">
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
        <details className="expression-planning"><summary>Reference Photos ({references.length})</summary>
          <p>Choose photos in the grid below as references. HeartQuarters remembers them on this computer.</p>
          {referenceError && <p className="error">{referenceError}</p>}
          <div className="reference-grid">{references.map((path) => {
            const photo = index.photos.find((p) => p.path === path);
            return <div key={path}>{photo ? <img src={thumbUrl('expressions', path, 240)} alt={photo.name} /> : <p>Photo no longer found: {path}</p>}<span>{photo?.name}</span><button className="small" disabled={!referenceReady || referenceBusy} onClick={() => void setReference(path, false)}>Remove</button></div>;
          })}</div>
          {!references.length && <p className="muted">No reference photos selected yet.</p>}
        </details>
        {current.path === '' && <details className="expression-planning"><summary>Categories to Consider</summary>
          <p className="muted">Starting suggestions: commonly useful expressions with fewer than five photos. Counts do not judge photo quality.</p>
          <div className="chips">{suggestedCategories(index.categories).map((c) => <button key={c.path} className="chip" onClick={() => goTo(c.path)}>{c.name} · {c.ownCount} photos</button>)}</div>
        </details>}
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
            <img className="expr-ref" src={thumbUrl('expressions', current.reference, 240)} alt="" />
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
        {current.path && subs.length === 0 && referenceReady && <ExpressionGenerator key={current.path} category={current} references={references} photos={index.photos} onSaved={() => { void getJson<ExpressionIndex>('/api/expressions').then(setIndex, (e) => setError(e.message)); }} />}

        {subs.length > 0 && (
          <div className="chips">
            {subs.map((c) => (
              <button key={c.path} className="chip" onClick={() => goTo(c.path)}>
                {c.name} <span className="muted">{c.totalCount}</span>
              </button>
            ))}
          </div>
        )}

        <p className="muted">
          {shown.length} photo{shown.length === 1 ? '' : 's'}
          {words.length > 0 && ` matching “${query.trim()}”`}
        </p>

        <div className="photo-grid">
          {shown.map((p, i) => (
            <div key={p.path} className="expression-photo-choice"><button className="photo" onClick={() => setOpen(i)} title={p.name}>
              <img src={thumbUrl('expressions', p.path)} alt={p.name} loading="lazy" />
              <span>{p.name}</span>
            </button><label><input type="checkbox" disabled={!referenceReady || referenceBusy} checked={references.includes(p.path)} onChange={(e) => void setReference(p.path, e.target.checked)} /> Reference Photo</label>
              <PhotoActions photo={p} rootDir={index.rootDir} categories={index.categories} onChanged={(message) => { setChangeMessage(message); void Promise.all([getJson<ExpressionIndex>('/api/expressions'), getJson<{ paths: string[] }>('/api/expression-references')]).then(([updated, refs]) => { setIndex(updated); setReferences(refs.paths); try { saveReferences(localStorage, refs.paths); } catch { /* server copy is authoritative */ } }, (e) => setError(e.message)); }} />
            </div>
          ))}
        </div>
      </section>

      {open !== null && shown[open] && (
        <Lightbox
          photo={shown[open]}
          onClose={() => setOpen(null)}
          onPrev={() => setOpen((open - 1 + shown.length) % shown.length)}
          onNext={() => setOpen((open + 1) % shown.length)}
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
      <button className="small" onClick={() => openInExplorer('expressions', photo.path)}>Open Folder</button>
      <button className="small" disabled={busy} onClick={() => { setOperation(operation === 'move' ? null : 'move'); setPlan(null); setMessage(''); }}>Move</button>
      <button className="small" disabled={busy} onClick={() => void preview('delete')}>Delete</button>
    </div>
    {operation === 'move' && <div className="expression-move"><label>Move to Category <select value={destination} disabled={busy} onChange={(e) => { setDestination(e.target.value); setPlan(null); }}><option value="">Choose a category…</option>{categories.filter(c => c.path && c.path !== photo.category).map(c => <option key={c.path} value={c.path}>{c.path.split('/').join(' › ')}</option>)}</select></label><button className="small" disabled={!destination || busy} onClick={() => void preview('move')}>Review Move</button></div>}
    {message && <p className="error">{message}</p>}
    {plan && <div className="expression-review"><p><strong>Review Changes</strong></p><ul>{plan.changes.map(c => <li key={c.from}>{c.from} → {c.to ?? 'HeartQuarters Trash'}</li>)}</ul><p>{plan.sidecars.length} photo and sidecar files will move. {plan.links.length} thumbnail references and {plan.references.length} saved reference photos will be updated.</p><details><summary>Files and Thumbnail References</summary><ul>{plan.sidecars.map(f => <li key={f}>{f}</li>)}{plan.links.map(f => <li key={f}>Thumbnail: {f}</li>)}</ul></details>{operation === 'delete' && plan.links.length > 0 && <p>Thumbnail projects using the deleted photo will keep a copy in their Drafts Source folder.</p>}<button disabled={busy} onClick={() => void apply()}>{operation === 'delete' ? 'Delete Photo' : 'Move Photo'}</button>{' '}<button disabled={busy} onClick={() => { setPlan(null); setOperation(null); }}>Cancel</button></div>}
  </div>;
}

function Lightbox({ photo, onClose, onPrev, onNext }: {
  photo: ExpressionPhoto; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [viewSize, setViewSize] = useState({ width: 0, height: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const center = useRef<{ x: number; y: number } | null>(null);
  const fit = fitScale(imageSize.width, imageSize.height, viewSize.width, viewSize.height);
  const maximum = Math.max(2, Math.ceil(1 / fit * 10) / 10);
  const changeZoom = (next: number | ((previous: number) => number)) => {
    const el = viewport.current;
    if (el) center.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setZoom(previous => clampZoom(typeof next === 'function' ? next(previous) : next, maximum));
  };
  useEffect(() => { setZoom(1); setImageSize({ width: 0, height: 0 }); center.current = null; }, [photo.path]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => setViewSize({ width: el.clientWidth, height: el.clientHeight });
    measure(); const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
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
      if (e.key === 'Escape') onClose();
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const tags = [...photo.tags].sort((a, b) => Number(b.confirmed) - Number(a.confirmed));

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <button className="lb-nav lb-prev" onClick={onPrev} title="Previous (←)">‹</button>
        {/* Preview first, swapped for the full-size photo once it has loaded. */}
        <div ref={viewport} className={`lb-viewport${zoom > 1 ? ' zoomed' : ''}`}
          onPointerDown={(e) => { if (zoom <= 1 || e.button !== 0) return; drag.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; const dx = e.clientX - d.x, dy = e.clientY - d.y; if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; if (d.moved) { e.currentTarget.scrollLeft = d.left - dx; e.currentTarget.scrollTop = d.top - dy; } }}
          onPointerUp={() => { suppressClick.current = drag.current?.moved ?? false; drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
          onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } changeZoom(zoom > 1 ? 1 : maximum); }}>
          <div className="lb-image-canvas" style={{ width: Math.max(viewSize.width, imageSize.width * fit * zoom), height: Math.max(viewSize.height, imageSize.height * fit * zoom) }}>
            <img className="lb-img" src={fileUrl('expressions', photo.path)} style={{ width: imageSize.width ? imageSize.width * fit * zoom : undefined, height: imageSize.height ? imageSize.height * fit * zoom : undefined, backgroundImage: `url("${thumbUrl('expressions', photo.path, 800)}")` }} alt={photo.name}
              onLoad={(e) => setImageSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
              role="button" tabIndex={0} aria-label={zoom > 1 ? 'Return photo to fit' : 'View photo at full size'} draggable={false}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); changeZoom(zoom > 1 ? 1 : maximum); } }} />
          </div>
        </div>
        <button className="lb-nav lb-next" onClick={onNext} title="Next (→)">›</button>
        <div className="lb-info">
          <div className="lb-title">
            <strong>{photo.name}</strong>
            <span className="muted">{photo.category.split('/').join(' › ')}</span>
          </div>
          {tags.length > 0 && (
            <div className="chips">
              {tags.map((t) => (
                <span
                  key={t.tag}
                  className={`tag ${t.confirmed ? 'confirmed' : ''}`}
                  title={t.confirmed ? 'Confirmed' : 'AI guess, not confirmed'}
                >
                  {t.tag}
                  {t.confidence !== null && <span className="muted"> {t.confidence}%</span>}
                </span>
              ))}
            </div>
          )}
          <div className="lb-zoom"><label htmlFor="expression-zoom">Zoom</label><input id="expression-zoom" type="range" min="100" max={Math.round(maximum * 100)} step="1" value={Math.round(zoom * 100)} onChange={(e) => changeZoom(Number(e.target.value) / 100)} /><span>{Math.round(zoom * 100)}%</span></div>
          <p className="muted small-text">Use the mouse wheel or slider to zoom, and drag to pan. Click the photo to switch between fit and full size.</p>
          <button className="small" onClick={onClose}>Close (Esc)</button>
        </div>
      </div>
    </div>
  );
}
