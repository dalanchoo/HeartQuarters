import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  fileUrl,
  formatSize,
  getJson,
  openInExplorer,
  thumbUrl,
  type Piece,
  type ProjectDetail,
  type CreateResult,
  type ManageResult,
  type ProjectNode,
} from './api';
import { ManageButtons } from './ManageFolder';
import { ClaudeEdit } from './ClaudeEdit';
import { ShortsPlanCard } from './ShortsPlan';
import { NewFolderButton } from './NewFolder';
import { PackagingDocShort, PackagingDocsWide, usePackagingDocs } from './PackagingDoc';
import { WriteMetadata } from './ShortMetadata';
import { LongformUrlBox } from './ShortsPlan';

// The selected folder is kept in the address, e.g.
// #Videos/005 - Ayahuasca%2F005B - Night One  (the "/" inside is encoded)
function projectFromHash(): string | null {
  const [, id] = location.hash.slice(1).split('/');
  return id ? decodeURIComponent(id) : null;
}

function linkTo(id: string) {
  return `#Videos/${encodeURIComponent(id)}`;
}

/** Series parts read in order (005A, 005B...); everything else newest first. */
function ordered(node: ProjectNode | null, nodes: ProjectNode[]): ProjectNode[] {
  return node?.kind === 'series' ? nodes : nodes.slice().reverse();
}

export function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(projectFromHash);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one after a new folder is made, so the list and the page re-read the disk.
  const [reloads, setReloads] = useState(0);
  // The note shown after making, renaming or deleting a folder.
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    getJson<ProjectNode[]>('/api/projects').then(setProjects, (e) => setError(e.message));
  }, [reloads]);

  useEffect(() => {
    const onHash = () => setSelected(projectFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function afterChange(showId: string, newNote: Note) {
    setReloads((n) => n + 1);
    setNote(newNote);
    location.hash = showId ? linkTo(showId) : '#Videos';
  }

  function onCreated(result: CreateResult) {
    afterChange(result.showId, {
      showId: result.showId,
      openPath: result.path,
      lines: [
        { ok: true, text: `Made "${result.path.split('/').at(-1)}" from the template.` },
        { ok: result.capcut.created, text: result.capcut.message },
      ],
    });
  }

  function onManaged(result: ManageResult) {
    const failed = /couldn't/i.test(result.message);
    afterChange(result.showId, { showId: result.showId, lines: [{ ok: !failed, text: result.message }] });
  }

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="sidebar-actions">
          <NewFolderButton kind="top" onCreated={onCreated} />
          <NewFolderButton kind="standalone" onCreated={onCreated} />
        </div>
        {error && <p className="error">{error}</p>}
        {!projects && !error && <p className="muted">Loading…</p>}
        {projects &&
          ordered(null, projects).map((p) => <TreeItem key={p.id} node={p} selected={selected} />)}
      </aside>
      <section className="content">
        {note && note.showId === (selected ?? '') && <NoteBox note={note} onDismiss={() => setNote(null)} />}
        {selected ? (
          <ProjectView id={selected} reloads={reloads} onCreated={onCreated} onManaged={onManaged} />
        ) : (
          <p className="muted">Pick a project on the left.</p>
        )}
      </section>
    </div>
  );
}

interface Note {
  showId: string;
  lines: { ok: boolean; text: string }[];
  openPath?: string;
}

/** Shown after making, renaming or deleting: what happened, including the CapCut drafts. */
function NoteBox({ note, onDismiss }: { note: Note; onDismiss: () => void }) {
  return (
    <div className={`notice ${note.lines.every((l) => l.ok) ? '' : 'notice-warn'}`}>
      <div>
        {note.lines.map((l, i) => (
          <div key={i}>
            {l.ok ? '✓ ' : '⚠ '}
            {l.text}
            {i === 0 && note.openPath && (
              <>
                {' '}
                <button className="small" onClick={() => openInExplorer('projects', note.openPath!)}>
                  Open folder
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <button className="small" onClick={onDismiss} title="Hide this note">
        ✕
      </button>
    </div>
  );
}

function NodeLink({ node, selected }: { node: ProjectNode; selected: string | null }) {
  return (
    <a href={linkTo(node.id)} className={`project-link ${node.id === selected ? 'active' : ''}`}>
      {node.number && <span className="num">{node.number}</span>}
      <span className="title">{node.title}</span>
      <span className="badges">
        {node.exported && <span title="Exported">🎬</span>}
        {node.kind !== 'short' && node.shortCount > 0 && <span title="Shorts">{node.shortCount}▮</span>}
      </span>
    </a>
  );
}

/** One row in the sidebar; series and groups can be expanded to show what's inside. */
function TreeItem({ node, selected }: { node: ProjectNode; selected: string | null }) {
  if (node.children.length === 0) {
    return (
      <div className="tree-leaf">
        <NodeLink node={node} selected={selected} />
      </div>
    );
  }
  const holdsSelection = !!selected && (selected === node.id || selected.startsWith(node.id + '/'));
  return (
    <details className="tree-node" open={holdsSelection}>
      <summary>
        <NodeLink node={node} selected={selected} />
      </summary>
      <div className="tree-children">
        {ordered(node, node.children).map((c) => (
          <TreeItem key={c.id} node={c} selected={selected} />
        ))}
      </div>
    </details>
  );
}

function ProjectView({
  id,
  reloads,
  onCreated,
  onManaged,
}: {
  id: string;
  reloads: number;
  onCreated: (result: CreateResult) => void;
  onManaged: (result: ManageResult) => void;
}) {
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false; // set when you pick another project before this one has loaded
    setProject(null);
    setError(null);
    getJson<ProjectDetail>(`/api/project?id=${encodeURIComponent(id)}`).then(
      (p) => !stale && setProject(p),
      (e) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [id, reloads]);

  // Picks up what changed in the folders, such as a new packaging version, without emptying the page first.
  const refresh = () => getJson<ProjectDetail>(`/api/project?id=${encodeURIComponent(id)}`).then(setProject, () => {});

  if (error) return <p className="error">{error}</p>;
  if (!project) return <p className="muted">Loading…</p>;

  // Breadcrumbs: "005 - Ayahuasca › 005B - Night One"
  const segments = project.id.split('/');
  const crumbs = segments.slice(0, -1).map((name, i) => ({ name, id: segments.slice(0, i + 1).join('/') }));
  const hasJobs =
    (project.kind === 'project' || project.kind === 'part') && project.videos.some((v) => v.pieces.some((p) => p.kind === 'longform'));
  const kindLabel = { series: 'Series', group: 'Folder', part: 'Part of a series', short: 'Standalone short', project: '' }[
    project.kind
  ];

  return (
    <div>
      {crumbs.length > 0 && (
        <div className="crumbs">
          {crumbs.map((c, i) => (
            <span key={c.id}>
              {i > 0 && <span className="muted"> › </span>}
              <a href={linkTo(c.id)}>{c.name}</a>
            </span>
          ))}
        </div>
      )}
      <div className="page-head">
        <h1>
          {project.number && <span className="num">{project.number}</span>} {project.title}
        </h1>
        <div className="head-actions">
          {project.kind === 'series' && <NewFolderButton kind="part" parent={project.id} onCreated={onCreated} />}
          {(project.kind === 'project' || project.kind === 'part') && (
            <NewFolderButton kind="short" parent={project.id} onCreated={onCreated} />
          )}
          {project.kind !== 'group' && <ManageButtons path={project.id} onDone={onManaged} />}
          <button onClick={() => openInExplorer('projects', project.path)}>Open folder</button>
        </div>
      </div>
      {kindLabel && <p className="muted">{kindLabel}</p>}

      {/* The longform, then the shorts that exist, then making more. */}
      {project.children.length > 0 ? (
        <ChildList node={project} />
      ) : (
        project.videos.map((video) => (
          <div key={video.path} className="video">
            {video.pieces.length === 0 && <p className="muted">No Longform, Shorts or Reels folders found.</p>}
            {video.pieces
              .filter((p) => p.kind === 'longform' || project.kind === 'short')
              .map((p) => (
                <PieceCard key={p.path} piece={p} startOpen>
                  {p.kind === 'longform' && hasJobs && (
                    <>
                      <ClaudeEdit video={project.id} />
                      <LongformUrlBox video={project.id} />
                    </>
                  )}
                </PieceCard>
              ))}
            {project.kind !== 'short' && (
              <PieceGroup
                title="Shorts"
                pieces={video.pieces.filter((p) => p.kind === 'short')}
                video={hasJobs ? project.id : undefined}
                onChanged={refresh}
                onManaged={onManaged}
              />
            )}
            <PieceGroup title="Reels" pieces={video.pieces.filter((p) => p.kind === 'reel')} onManaged={onManaged} />
          </div>
        ))
      )}
      {hasJobs && (
        <Section name="make-shorts" title="Make shorts">
          <ShortsPlanCard video={project.id} />
        </Section>
      )}
    </div>
  );
}

/** For a series or a folder: what's inside, each linking to its own page. */
function ChildList({ node }: { node: ProjectDetail }) {
  return (
    <div className="child-list">
      {ordered(node, node.children).map((c) => (
        <a key={c.id} href={linkTo(c.id)} className="card child-card">
          {c.number && <span className="num">{c.number}</span>}
          <span className="piece-name">{c.title}</span>
          <span className="muted">
            {c.kind === 'group'
              ? `${c.children.length} item${c.children.length === 1 ? '' : 's'}`
              : c.exported
                ? '✓ exported'
                : 'not exported'}
            {c.kind !== 'short' && c.shortCount > 0 && ` · ${c.shortCount} shorts`}
          </span>
        </a>
      ))}
    </div>
  );
}

function PieceGroup({
  title,
  pieces,
  video,
  onChanged,
  onManaged,
}: {
  title: string;
  pieces: Piece[];
  /** Given when the AI can write these shorts' metadata. */
  video?: string;
  onChanged?: () => void;
  onManaged: (result: ManageResult) => void;
}) {
  if (pieces.length === 0) return null;
  return (
    <Section name={title.toLowerCase()} title={title} count={pieces.length}>
      {pieces.map((p) => (
        <PieceCard key={p.path} piece={p} video={video} onChanged={onChanged} onManaged={onManaged} />
      ))}
    </Section>
  );
}

/** "V05_Shock" -> "V05 · Shock" */
function versionLabel(name: string): string {
  const [num, ...rest] = name.split('_');
  return rest.length ? `${num} · ${rest.join(' ')}` : num;
}

// Whether a part of the page was left open or closed. Only a convenience: without it, each part starts open.
function rememberedOpen(name: string): boolean {
  try {
    return localStorage.getItem(`hq-${name}-open`) !== 'false';
  } catch {
    return true;
  }
}

function rememberOpen(name: string, open: boolean) {
  try {
    localStorage.setItem(`hq-${name}-open`, String(open));
  } catch {
    // Not remembered, then.
  }
}

/** A part of a video's page that folds away, and stays as it was left. */
function Section({ name, title, count, children }: { name: string; title: string; count?: number; children: ReactNode }) {
  const [open, setOpen] = useState(() => rememberedOpen(name));
  return (
    <details
      className="page-section"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        rememberOpen(name, now);
      }}
    >
      <summary>
        {title}
        {count !== undefined && <span className="muted"> ({count})</span>}
      </summary>
      {children}
    </details>
  );
}

function PieceCard({
  piece,
  startOpen = false,
  video,
  onChanged,
  onManaged,
  children,
}: {
  piece: Piece;
  startOpen?: boolean;
  /** Given when the AI can write this short's metadata. */
  video?: string;
  /** Called when something changed in the folders, such as a new packaging version. */
  onChanged?: () => void;
  /** Shown at the top of the card when it's open. */
  children?: ReactNode;
  /** Given for shorts and reels inside a video, which get Rename / Delete buttons. */
  onManaged?: (result: ManageResult) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const [versionName, setVersionName] = useState(piece.packagingVersion);
  const version = piece.versions.find((v) => v.name === versionName) ?? piece.versions.at(-1);
  const latest = piece.versions.at(-1)?.name;
  const [docsLoads, setDocsLoads] = useState(0);
  const docs = usePackagingDocs(version?.docs ?? [], docsLoads);
  const playerRef = useRef<HTMLVideoElement>(null);
  const isLongform = piece.kind === 'longform';
  const [open, setOpen] = useState(() => (isLongform ? rememberedOpen('longform') : startOpen));

  // When you press Play, bring the player into view.
  useEffect(() => {
    if (playing) playerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [playing]);

  return (
    <details
      className="card"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        if (isLongform) rememberOpen('longform', now);
      }}
    >
      <summary>
        {isLongform && <span className="piece-kind">Longform</span>}
        <span className="piece-name">{piece.name}</span>
        <span className="muted">
          {piece.exports.length > 0 ? '✓ exported' : 'not exported'}
          {piece.packagingVersion
            ? ` · packaging ${versionLabel(piece.packagingVersion)}` +
              (piece.versions.length > 1 ? ` (${piece.versions.length} versions)` : '')
            : ' · no packaging'}
        </span>
      </summary>

      {children}

      {/* The player sits at the top of the card, full width, and scrolls into view. */}
      {playing && (
        <video
          key={playing}
          className="player"
          src={fileUrl('projects', playing)}
          controls
          autoPlay
          preload="metadata"
          ref={playerRef}
        />
      )}

      {/* Two columns: thumbnails, exports and versions on the left; text on the right. */}
      <div className="piece-body">
        <div className="piece-media">
          {version && version.covers.length > 0 && (
            <div className="cover-stack">
              {version.covers.map((f, i) => (
                <a
                  key={f.path}
                  className={i === 0 ? 'cover-main' : 'cover-extra'}
                  href={fileUrl('projects', f.path)}
                  target="_blank"
                  rel="noreferrer"
                  title={`${f.name} (click for full size)`}
                >
                  <img src={thumbUrl('projects', f.path, i === 0 ? 640 : 240)} alt={f.name} loading="lazy" />
                </a>
              ))}
            </div>
          )}

          {piece.exports.map((f) => (
            <div key={f.path} className="export-row" title={f.name}>
              <button className="small" onClick={() => setPlaying(playing === f.path ? null : f.path)}>
                {playing === f.path ? '■ Hide' : '▶ Play'}
              </button>
              <span className="ellipsis">{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
            </div>
          ))}

          {version && (
            <div className="versions">
              {piece.versions.map((v) => (
                <button
                  key={v.name}
                  className={`version small ${v.name === version.name ? 'active' : ''}`}
                  onClick={() => setVersionName(v.name)}
                  title={v.name === latest ? 'Latest version' : undefined}
                >
                  {versionLabel(v.name)}
                  {v.name === latest && piece.versions.length > 1 && <span className="latest">latest</span>}
                </button>
              ))}
            </div>
          )}

          <div className="versions">
            <button className="small" onClick={() => openInExplorer('projects', piece.path)}>
              Open folder
            </button>
            {version && (
              <button className="small" onClick={() => openInExplorer('projects', version.path)}>
                Open {versionLabel(version.name)} folder
              </button>
            )}
            {onManaged && <ManageButtons path={piece.path} onDone={onManaged} />}
          </div>
        </div>

        <div className="piece-docs">
          {video && piece.kind === 'short' && (
            <WriteMetadata
              video={video}
              short={piece.name}
              onFinished={() => {
                setDocsLoads((n) => n + 1);
                onChanged?.();
              }}
            />
          )}
          {!version && <p className="muted">No packaging yet.</p>}
          {version && version.docs.length === 0 && <p className="muted">No text files in this version.</p>}
          {docs.slice(0, 1).map((d) => (
            <PackagingDocShort key={d.file.path} doc={d} />
          ))}
        </div>
      </div>

      {/* The main file's Description, then the other platforms, run full width under both columns. */}
      <PackagingDocsWide docs={docs} />
    </details>
  );
}
