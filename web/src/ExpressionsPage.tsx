import { useEffect, useMemo, useState } from 'react';
import {
  fileUrl,
  getJson,
  openInExplorer,
  thumbUrl,
  type ExpressionCategory,
  type ExpressionIndex,
  type ExpressionPhoto,
} from './api';
import { CopyButton } from './PackagingDoc';

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

  useEffect(() => {
    getJson<ExpressionIndex>('/api/expressions').then(setIndex, (e) => setError(e.message));
    const onHash = () => {
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

        <div className="expr-head">
          {current.reference && (
            <img className="expr-ref" src={thumbUrl('expressions', current.reference, 240)} alt="" />
          )}
          <div>
            <h1>{current.name}</h1>
            {current.definition && <p className="expr-def">{current.definition}</p>}
            <div className="versions">
              <button className="small" onClick={() => openInExplorer('expressions', current.path)}>
                Open folder
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
            <button key={p.path} className="photo" onClick={() => setOpen(i)} title={p.name}>
              <img src={thumbUrl('expressions', p.path)} alt={p.name} loading="lazy" />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </section>

      {open !== null && shown[open] && (
        <Lightbox
          photo={shown[open]}
          rootDir={index.rootDir}
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

function Lightbox({
  photo,
  rootDir,
  onClose,
  onPrev,
  onNext,
}: {
  photo: ExpressionPhoto;
  rootDir: string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const fullPath = `${rootDir}\\${photo.path.split('/').join('\\')}`;
  const tags = [...photo.tags].sort((a, b) => Number(b.confirmed) - Number(a.confirmed));

  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-body" onClick={(e) => e.stopPropagation()}>
        <button className="lb-nav lb-prev" onClick={onPrev} title="Previous (←)">‹</button>
        {/* Preview first, swapped for the full-size photo once it has loaded. */}
        <img
          className="lb-img"
          src={fileUrl('expressions', photo.path)}
          style={{ backgroundImage: `url("${thumbUrl('expressions', photo.path, 800)}")` }}
          alt={photo.name}
        />
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
          <div className="versions">
            <CopyButton text={fullPath} label="Copy file path" />
            <button className="small" onClick={() => openInExplorer('expressions', photo.path)}>
              Open folder
            </button>
            <a className="small button-link" href={fileUrl('expressions', photo.path)} target="_blank" rel="noreferrer">
              Full size ↗
            </a>
            <button className="small" onClick={onClose}>Close (Esc)</button>
          </div>
        </div>
      </div>
    </div>
  );
}
