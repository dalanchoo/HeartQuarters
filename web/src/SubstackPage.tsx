import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  fileUrl,
  formatSize,
  getJson,
  openInExplorer,
  thumbUrl,
  type FileRef,
  type WritingDetail,
  type WritingSummary,
} from './api';

interface Section {
  section: string;
  pieces: WritingSummary[];
}

// The selected piece is kept in the address: #Substack/My Journey/2022-02 – Kinbaku
function pieceFromHash(): string | null {
  const rest = location.hash.slice(1).split('/').slice(1).join('/');
  return rest ? decodeURIComponent(rest) : null;
}

export function SubstackPage() {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [selected, setSelected] = useState<string | null>(pieceFromHash);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Section[]>('/api/writing').then(setSections, (e) => setError(e.message));
    const onHash = () => setSelected(pieceFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="split">
      <aside className="sidebar">
        {error && <p className="error">{error}</p>}
        {!sections && !error && <p className="muted">Loading…</p>}
        {sections?.map((s) => (
          <details key={s.section} className="sidebar-section" open>
            <summary>
              {s.section} <span className="muted">({s.pieces.length})</span>
            </summary>
            {s.pieces.map((p) => (
              <a
                key={p.id}
                href={`#Substack/${encodeURIComponent(p.id)}`}
                className={`project-link ${p.id === selected ? 'active' : ''}`}
              >
                {p.date && <span className="num">{p.date}</span>}
                <span className="title">{p.title}</span>
                {p.draftCount === 0 && <span className="muted" title="No drafts">–</span>}
              </a>
            ))}
          </details>
        ))}
      </aside>
      <section className="content">
        {selected ? <PieceView id={selected} /> : <p className="muted">Pick a piece on the left.</p>}
      </section>
    </div>
  );
}

function PieceView({ id }: { id: string }) {
  const [piece, setPiece] = useState<WritingDetail | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false; // set when you pick another piece before this one has loaded
    setPiece(null);
    setError(null);
    getJson<WritingDetail>(`/api/writing/piece?id=${encodeURIComponent(id)}`).then(
      (p) => {
        if (stale) return;
        setPiece(p);
        setDraft(p.drafts[0]?.path ?? null);
      },
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!piece) return <p className="muted">Loading…</p>;

  const hasDrafts = piece.drafts.length > 0 || piece.googleDocs.length > 0;

  return (
    <div>
      <div className="page-head">
        <h1>
          {piece.date && <span className="num">{piece.date}</span>} {piece.title}
          <span className="h1-note">{piece.section}</span>
        </h1>
        <button className="small" onClick={() => openInExplorer('writing', piece.id)}>
          Open folder
        </button>
      </div>

      <div className="card">
        {/* Top: the Substack preview on the left; videos and photos beside it. */}
        <div className="piece-body" style={{ marginTop: 0 }}>
          <div className="piece-media">
            {piece.previews.length > 0 ? (
              <a className="cover-main" href={fileUrl('writing', piece.previews[0].path)} target="_blank" rel="noreferrer"
                 title="Substack preview (click for full size)">
                <img src={thumbUrl('writing', piece.previews[0].path, 640)} alt="Substack preview" />
              </a>
            ) : (
              <p className="muted">No Substack preview image.</p>
            )}
          </div>

          <div className="piece-docs">
            {piece.videos.length > 0 && (
              <>
                <h4>Videos ({piece.videos.length})</h4>
                <VideoList files={piece.videos} />
              </>
            )}
            {piece.images.length > 0 && (
              <>
                <h4>Images ({piece.images.length})</h4>
                <ImageGrid files={piece.images} />
              </>
            )}
            {piece.videos.length === 0 && piece.images.length === 0 && (
              <p className="muted">No photos or videos in this folder.</p>
            )}
          </div>
        </div>

        {/* Below, full width: the drafts. */}
        <div className="piece-wide">
          <h4>Drafts</h4>
          {!hasDrafts && <p className="muted">No drafts in this folder.</p>}
          {hasDrafts && (
            <div className="versions">
              {piece.drafts.map((d) => (
                <button
                  key={d.path}
                  className={`version small ${d.path === draft ? 'active' : ''}`}
                  onClick={() => setDraft(d.path)}
                >
                  {d.name.split('/').pop()?.replace(/\.docx$/i, '')}
                </button>
              ))}
              {piece.googleDocs.map((g) => (
                <a key={g.url} className="button-link small" href={g.url} target="_blank" rel="noreferrer">
                  {g.name} ↗ <span className="muted">Google Doc</span>
                </a>
              ))}
            </div>
          )}
          {draft && <DraftView path={draft} />}
        </div>
      </div>
    </div>
  );
}

function DraftView({ path }: { path: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false; // set when you pick another draft before this one has loaded
    setHtml(null);
    setError(null);
    getJson<{ html: string }>(`/api/writing/draft?path=${encodeURIComponent(path)}`).then(
      // Clean the converted Word file before showing it: removes scripts and
      // dangerous links (e.g. "javascript:") a document could contain.
      (r) => !stale && setHtml(DOMPurify.sanitize(r.html)),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [path]);

  return (
    <div className="draft">
      <div className="draft-actions">
        <button className="small" onClick={() => openInExplorer('writing', path)}>
          Open folder
        </button>
        <a className="small button-link" href={fileUrl('writing', path)} download>
          Download .docx
        </a>
      </div>
      {error && <p className="error">{error}</p>}
      {html === null && !error && <p className="muted">Loading…</p>}
      {html === '' && <p className="muted">This draft is empty.</p>}
      {/* Converted from your Word file on this PC, then cleaned by DOMPurify above. */}
      {html && <article className="markdown draft-body" dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

/** Small square previews; click one for full size. */
function ImageGrid({ files }: { files: FileRef[] }) {
  return (
    <div className="thumb-grid">
      {files.map((f) => (
        <a key={f.path} href={fileUrl('writing', f.path)} target="_blank" rel="noreferrer" title={f.name}>
          <img src={thumbUrl('writing', f.path, 240)} alt={f.name} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

function VideoList({ files }: { files: FileRef[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <div>
      {files.map((f) => (
        <div key={f.path} className="export-row" title={f.name}>
          <button className="small" onClick={() => setPlaying(playing === f.path ? null : f.path)}>
            {playing === f.path ? '■ Hide' : '▶ Play'}
          </button>
          <span className="ellipsis">{f.name}</span>
          <span className="muted">{formatSize(f.size)}</span>
        </div>
      ))}
      {playing && <video className="player" src={fileUrl('writing', playing)} controls autoPlay />}
    </div>
  );
}
