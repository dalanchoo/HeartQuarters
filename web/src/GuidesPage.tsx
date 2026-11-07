import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, getText, openInExplorer, type RootId } from './api';

interface Guide {
  name: string;
  root: RootId;
  path: string;
  found: boolean;
}

// Read-only view of the instruction files Claude follows (LONGFORM.md etc.).
export function GuidesPage() {
  const [guides, setGuides] = useState<Guide[]>([]);
  const [current, setCurrent] = useState<Guide | null>(null);
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Guide[]>('/api/guides').then((g) => {
      setGuides(g);
      setCurrent(g.find((x) => x.found) ?? null);
    }, (e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!current) return;
    let stale = false; // set when you pick another guide before this one has loaded
    setText('');
    getText(current.root, current.path).then(
      (t) => !stale && setText(t),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [current]);

  return (
    <div className="split">
      <aside className="sidebar">
        {guides.map((g) => (
          <a
            key={g.root + g.path}
            href="#Guides"
            className={`project-link ${g === current ? 'active' : ''} ${g.found ? '' : 'missing'}`}
            onClick={(e) => {
              e.preventDefault();
              if (g.found) setCurrent(g);
            }}
          >
            <span className="title">{g.name}</span>
            {!g.found && <span className="muted">missing</span>}
          </a>
        ))}
      </aside>
      <section className="content">
        {error && <p className="error">{error}</p>}
        {current && (
          <>
            <div className="page-head">
              <span className="muted">{current.path}</span>
              <button onClick={() => openInExplorer(current.root, current.path)}>Open folder</button>
            </div>
            <article className="markdown">
              <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
            </article>
          </>
        )}
      </section>
    </div>
  );
}
