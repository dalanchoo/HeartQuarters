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

// The selected project is kept in the address: #Videos/022 - Worth Telling Them
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
              href={`#Videos/${encodeURIComponent(p.id)}`}
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
    let stale = false; // set when you pick another project before this one has loaded
    setProject(null);
    setError(null);
    getJson<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`).then(
      (p) => !stale && setProject(p),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
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

/** "V05_Shock" -> "V05 · Shock" */
function versionLabel(name: string): string {
  const [num, ...rest] = name.split('_');
  return rest.length ? `${num} · ${rest.join(' ')}` : num;
}

function PieceCard({ piece, startOpen = false }: { piece: Piece; startOpen?: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [versionName, setVersionName] = useState(piece.packagingVersion);
  const version = piece.versions.find((v) => v.name === versionName) ?? piece.versions.at(-1);
  const latest = piece.versions.at(-1)?.name;

  return (
    <details className="card" open={startOpen}>
      <summary>
        <span className="piece-name">{piece.name}</span>
        <span className="muted">
          {piece.exports.length > 0 ? '✓ exported' : 'not exported'}
          {piece.packagingVersion
            ? ` · packaging ${versionLabel(piece.packagingVersion)}` +
              (piece.versions.length > 1 ? ` (${piece.versions.length} versions)` : '')
            : ' · no packaging'}
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

      {version && (
        <div className="block">
          <h4>Packaging</h4>
          <div className="versions">
            {piece.versions.map((v) => (
              <button
                key={v.name}
                className={`version ${v.name === version.name ? 'active' : ''}`}
                onClick={() => setVersionName(v.name)}
              >
                {versionLabel(v.name)}
                {v.name === latest && piece.versions.length > 1 && <span className="latest">latest</span>}
              </button>
            ))}
            <button className="small" onClick={() => openInExplorer('projects', version.path)}>
              Open {versionLabel(version.name)} folder
            </button>
          </div>
          {version.docs.length === 0 && version.covers.length === 0 && (
            <p className="muted">This version folder is empty.</p>
          )}
        </div>
      )}

      {version && version.covers.length > 0 && (
        <div className="block">
          <h4>Covers</h4>
          <div className="covers">
            {version.covers.map((f) => (
              <a key={f.path} href={fileUrl('projects', f.path)} target="_blank" rel="noreferrer" title={f.name}>
                <img src={fileUrl('projects', f.path)} alt={f.name} loading="lazy" />
                <span>{f.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {version?.docs.map((d) => (
        <PackagingDoc key={d.path} file={d} />
      ))}
    </details>
  );
}
