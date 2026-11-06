import { useEffect, useState } from 'react';
import {
  fileUrl,
  formatSize,
  getJson,
  openInExplorer,
  type Piece,
  type ProjectDetail,
  type ProjectSummary,
} from './api';
import { PackagingDoc } from './PackagingDoc';

// The selected project is kept in the address: #Projects/022 - Worth Telling Them
function projectFromHash(): string | null {
  const [, id] = location.hash.slice(1).split('/');
  return id ? decodeURIComponent(id) : null;
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(projectFromHash);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<ProjectSummary[]>('/api/projects').then(setProjects, (e) => setError(e.message));
    const onHash = () => setSelected(projectFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="split">
      <aside className="sidebar">
        {error && <p className="error">{error}</p>}
        {!projects && !error && <p className="muted">Loading…</p>}
        {projects
          ?.slice()
          .reverse()
          .map((p) => (
            <a
              key={p.id}
              href={`#Projects/${encodeURIComponent(p.id)}`}
              className={`project-link ${p.id === selected ? 'active' : ''}`}
            >
              <span className="num">{p.number}</span>
              <span className="title">{p.title}</span>
              <span className="badges">
                {p.longformExported && <span title="Long-form exported">🎬</span>}
                {p.shortCount > 0 && <span title="Shorts">{p.shortCount}▮</span>}
              </span>
            </a>
          ))}
      </aside>
      <section className="content">
        {selected ? <ProjectView id={selected} /> : <p className="muted">Pick a project on the left.</p>}
      </section>
    </div>
  );
}

function ProjectView({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProject(null);
    setError(null);
    getJson<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`).then(setProject, (e) =>
      setError(e.message),
    );
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Loading…</p>;

  const isSeries = project.videos.length > 1 || project.videos[0]?.path !== project.path;

  return (
    <div>
      <div className="page-head">
        <h1>
          <span className="num">{project.number}</span> {project.title}
        </h1>
        <button onClick={() => openInExplorer('projects', project.path)}>Open folder</button>
      </div>

      {project.videos.map((video) => (
        <div key={video.path} className="video">
          {isSeries && <h2>{video.name}</h2>}
          {video.pieces.length === 0 && <p className="muted">No Longform, Shorts or Reels folders found.</p>}
          {video.pieces
            .filter((p) => p.kind === 'longform')
            .map((p) => (
              <PieceCard key={p.path} piece={p} startOpen />
            ))}
          <PieceGroup title="Shorts" pieces={video.pieces.filter((p) => p.kind === 'short')} />
          <PieceGroup title="Reels" pieces={video.pieces.filter((p) => p.kind === 'reel')} />
        </div>
      ))}
    </div>
  );
}

function PieceGroup({ title, pieces }: { title: string; pieces: Piece[] }) {
  if (pieces.length === 0) return null;
  return (
    <div className="piece-group">
      <h3>
        {title} <span className="muted">({pieces.length})</span>
      </h3>
      {pieces.map((p) => (
        <PieceCard key={p.path} piece={p} />
      ))}
    </div>
  );
}

function PieceCard({ piece, startOpen = false }: { piece: Piece; startOpen?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <details className="card" open={startOpen}>
      <summary>
        <span className="piece-name">{piece.name}</span>
        <span className="muted">
          {piece.exports.length > 0 ? '✓ exported' : 'not exported'}
          {piece.packagingVersion ? ` · packaging ${piece.packagingVersion}` : ' · no packaging'}
        </span>
      </summary>

      <div className="card-actions">
        <button onClick={() => openInExplorer('projects', piece.path)}>Open folder</button>
      </div>

      {piece.exports.length > 0 && (
        <div className="block">
          <h4>Exports</h4>
          {piece.exports.map((f) => (
            <div key={f.path} className="export-row">
              <span>{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
              <button onClick={() => setPlaying(playing === f.path ? null : f.path)}>
                {playing === f.path ? 'Hide' : 'Play'}
              </button>
            </div>
          ))}
          {playing && (
            <video className="player" src={fileUrl('projects', playing)} controls autoPlay preload="metadata" />
          )}
        </div>
      )}

      {piece.covers.length > 0 && (
        <div className="block">
          <h4>Covers</h4>
          <div className="covers">
            {piece.covers.map((f) => (
              <a key={f.path} href={fileUrl('projects', f.path)} target="_blank" rel="noreferrer" title={f.name}>
                <img src={fileUrl('projects', f.path)} alt={f.name} loading="lazy" />
                <span>{f.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {piece.docs.map((d) => (
        <PackagingDoc key={d.path} file={d} />
      ))}
    </details>
  );
}
