import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  copyText,
  getJson,
  openInExplorer,
  postJson,
  type Piece,
  type ProjectDetail,
  type CreateResult,
  type ManageResult,
  type ProjectNode,
} from './api';
import { ManageButtons } from './ManageFolder';
import { ShortsPlanCard } from './ShortsPlan';
import { NewFolderButton } from './NewFolder';
import { PackagingDocShort, PackagingDocsWide, PackagingOtherPlatforms, usePackagingDocs } from './PackagingDoc';
import { PieceAI } from './PieceAI';
import { YouTubeUpload } from './YouTubeUpload';
import { VideoPreview } from './VideoPreview';
import { ThumbnailImport } from './ThumbnailImport';
import { addThumbnailPlanningFields } from './packaging';
import type { VideoOverview } from '../../server/video-overview';
import type { YoutubeChecks } from './videoChecks';
import { checkYoutubeVideo } from './videoChecks';
import type { YoutubeVideoSettings } from '../../server/youtube-video';

type Filter = 'all' | 'missing-link' | 'review' | 'legacy';
const StatusContext = createContext<{ items: VideoOverview[]; checks: Record<string, YoutubeChecks>; focus: string | null }>({ items: [], checks: {}, focus: null });
function shortFocus(): string | null { const [, , piece] = location.hash.slice(1).split('/'); try { return piece ? decodeURIComponent(piece) : null; } catch { return null; } }
function needsReview(item: VideoOverview, checks: Record<string, YoutubeChecks>): boolean { return item.link !== 'linked' || !item.localThumbnail || !!checks[item.path]?.issues.length || !!checks[item.path]?.unknown.length; }
function matchesFilter(item: VideoOverview, checks: Record<string, YoutubeChecks>, filter: Filter): boolean {
  return filter === 'all' || (filter === 'missing-link' && item.link === 'missing') || (filter === 'review' && needsReview(item, checks)) || (filter === 'legacy' && item.legacy);
}
function StatusBadges({ item, checks }: { item?: VideoOverview; checks?: YoutubeChecks }) {
  if (!item) return null;
  const text = item.link === 'linked' ? 'YT linked' : item.link === 'missing' ? 'YT no link' : 'YT unknown';
  const hint = item.link === 'linked' ? 'A YouTube link is saved in HeartQuarters or the longform URL file.' : item.link === 'missing' ? 'No YouTube link is saved here. This does not mean the video is absent from YouTube.' : 'The saved link status could not be determined.';
  return <span className="status-badges"><span className={`status-pill status-${item.link}`} title={hint}>{text}</span>{!item.localThumbnail && <span className="status-pill status-review" title="No thumbnail was found in the latest local packaging version">No local cover</span>}{item.legacy && <span className="status-pill status-legacy" title="A Legacy packaging folder exists">Legacy</span>}{checks && checks.issues.length > 0 && <span className="status-pill status-review" title={`YouTube: ${checks.issues.join('; ')}`}>{checks.issues.length} to review</span>}{checks && checks.unknown.length > 0 && <span className="status-pill status-unknown" title={`YouTube could not confirm: ${checks.unknown.join('; ')}`}>Check incomplete</span>}</span>;
}
function PieceStatus({ path, details = false }: { path: string; details?: boolean }) {
  const { items, checks } = useContext(StatusContext);
  const item = items.find((entry) => entry.path === path); if (!item) return null;
  const checked = checks[path];
  return <span className="piece-status"><StatusBadges item={item} checks={checked} />{details && <span className="status-explanation">{item.localThumbnail ? 'Local thumbnail found' : 'No local thumbnail in latest version'}{checked ? ` · YouTube: ${checked.issues.length ? checked.issues.join(', ') : 'no checked issues'}${checked.unknown.length ? `; not confirmed: ${checked.unknown.join(', ')}` : ''}` : ' · YouTube details not checked yet'}</span>}</span>;
}

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
  const [overview, setOverview] = useState<VideoOverview[]>([]);
  const [overviewError, setOverviewError] = useState('');
  const [checks, setChecks] = useState<Record<string, YoutubeChecks>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [focus, setFocus] = useState<string | null>(shortFocus);
  const [scan, setScan] = useState(''); const [scanning, setScanning] = useState(false);
  const scanEpoch = useRef(0);

  useEffect(() => {
    getJson<ProjectNode[]>('/api/projects').then(setProjects, (e) => setError(e.message));
  }, [reloads]);

  useEffect(() => {
    const onHash = () => { setSelected(projectFromHash()); setFocus(shortFocus()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => getJson<VideoOverview[]>('/api/video-overview').then((items) => { if (active) { setOverview(items); setOverviewError(''); } }, (e) => { if (active) setOverviewError(e.message); });
    const changed = (event: Event) => { const piece = (event as CustomEvent<string>).detail; if (piece) { scanEpoch.current++; setChecks((old) => { const next = { ...old }; delete next[piece]; return next; }); } void load(); };
    const checked = (event: Event) => { const { path, checks: values } = (event as CustomEvent<{ path: string; checks: YoutubeChecks }>).detail; setChecks((old) => ({ ...old, [path]: values })); };
    void load(); window.addEventListener('hq-video-status-changed', changed); window.addEventListener('hq-youtube-checked', checked);
    return () => { active = false; window.removeEventListener('hq-video-status-changed', changed); window.removeEventListener('hq-youtube-checked', checked); };
  }, [reloads]);

  async function checkLinkedVideos() {
    const candidates = overview.filter((item) => item.videoId);
    const ambiguous = overview.filter((item) => item.link === 'linked' && !item.videoId).length;
    if (!candidates.length) { setScan('No uniquely linked videos are available to check.'); return; }
    if (!window.confirm(`Check ${candidates.length} linked video${candidates.length === 1 ? '' : 's'} on YouTube? This reads each video and its captions and uses YouTube API quota.`)) return;
    const epoch = ++scanEpoch.current; let index = 0; let done = 0; let failures = 0;
    setScanning(true); setScan(`Checking 0 of ${candidates.length}…`);
    const worker = async () => {
      while (index < candidates.length && epoch === scanEpoch.current) {
        const item = candidates[index++];
        try {
          const result = await getJson<{ video: YoutubeVideoSettings; captions: { kind: string }[] | null }>(`/api/youtube/check-video?id=${encodeURIComponent(item.videoId!)}`);
          if (epoch === scanEpoch.current) setChecks((old) => ({ ...old, [item.path]: checkYoutubeVideo(result.video, result.captions, item.kind === 'short') }));
        } catch { failures++; if (epoch === scanEpoch.current) setChecks((old) => ({ ...old, [item.path]: { issues: [], unknown: ['YouTube check failed'] } })); }
        done++; if (epoch === scanEpoch.current) setScan(`Checking ${done} of ${candidates.length}…`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
    setScanning(false);
    setScan(epoch !== scanEpoch.current ? 'Check stopped because a video link changed. Run it again to update the list.' : `Checked ${done} video${done === 1 ? '' : 's'}.${failures ? ` ${failures} could not be checked.` : ''}${ambiguous ? ` ${ambiguous} with multiple saved links need to be checked individually.` : ''}`);
  }

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
    <StatusContext.Provider value={{ items: overview, checks, focus }}><div className="split">
      <aside className="sidebar">
        <div className="sidebar-actions">
          <NewFolderButton kind="top" onCreated={onCreated} />
          <NewFolderButton kind="standalone" onCreated={onCreated} />
        </div>
        <label className="status-filter">Show <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}><option value="all">All videos</option><option value="missing-link">No saved YouTube link</option><option value="review">Needs review</option><option value="legacy">Has Legacy packaging</option></select></label>
        <p className="status-legend">YT linked / YT no link refers to saved links. YouTube checks last for this session; check again after changing Studio.</p>
        <button className="small" disabled={scanning || !overview.length} onClick={() => void checkLinkedVideos()}>{scanning ? 'Checking YouTube…' : 'Check linked videos on YouTube'}</button>
        {scan && <p className="status-legend" role="status">{scan}</p>}
        {overviewError && <p className="error">Video status unavailable: {overviewError}</p>}
        {error && <p className="error">{error}</p>}
        {!projects && !error && <p className="muted">Loading…</p>}
        {projects &&
          ordered(null, projects).map((p) => <TreeItem key={p.id} node={p} selected={selected} filter={filter} />)}
      </aside>
      <section className="content">
        {note && note.showId === (selected ?? '') && <NoteBox note={note} onDismiss={() => setNote(null)} />}
        {selected ? (
          <ProjectView id={selected} reloads={reloads} onCreated={onCreated} onManaged={onManaged} />
        ) : (
          <p className="muted">Pick a project on the left.</p>
        )}
      </section>
    </div></StatusContext.Provider>
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
  const { items, checks, focus } = useContext(StatusContext);
  const primary = items.find((item) => item.projectId === node.id && (item.kind === 'longform' || node.kind === 'short'));
  return (
    <a href={linkTo(node.id)} className={`project-link ${node.id === selected && !focus ? 'active' : ''}`}>
      {node.number && <span className="num">{node.number}</span>}
      <span className="title">{node.title}</span>
      <span className="badges">
        {node.exported && <span title="Exported">🎬</span>}
        {node.kind !== 'short' && node.shortCount > 0 && <span title="Shorts">{node.shortCount}▮</span>}
      </span>
      <StatusBadges item={primary} checks={primary && checks[primary.path]} />
    </a>
  );
}

/** One row in the sidebar; series and groups can be expanded to show what's inside. */
function TreeItem({ node, selected, filter }: { node: ProjectNode; selected: string | null; filter: Filter }) {
  const { items, checks, focus } = useContext(StatusContext);
  const relevant = items.filter((item) => item.projectId === node.id || item.projectId.startsWith(`${node.id}/`));
  if (filter !== 'all' && !relevant.some((item) => matchesFilter(item, checks, filter))) return null;
  const shorts = node.kind !== 'short' ? items.filter((item) => item.projectId === node.id && item.kind === 'short' && matchesFilter(item, checks, filter)) : [];
  if (node.children.length === 0 && shorts.length === 0) {
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
          <TreeItem key={c.id} node={c} selected={selected} filter={filter} />
        ))}
        {shorts.map((short) => <a key={short.path} href={`${linkTo(node.id)}/${encodeURIComponent(short.path)}`} className={`project-link short-tree-link ${focus === short.path && selected === node.id ? 'active' : ''}`}><span className="title">{short.name}</span><StatusBadges item={short} checks={checks[short.path]} /></a>)}
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
  const refresh = () => { window.dispatchEvent(new CustomEvent('hq-video-status-changed')); return getJson<ProjectDetail>(`/api/project?id=${encodeURIComponent(id)}`).then(setProject, () => {}); };

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
          <button onClick={() => openInExplorer('projects', project.path)}>Open folder</button>
          {project.kind === 'series' && <ManageButtons path={project.id} onDone={onManaged} />}
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
              .map((p) =>
                p.kind === 'longform' ? (
                  <Section key={p.path} name="longform" title="Longform" detail={<>{pieceSummary(p)} <PieceStatus path={p.path} /></>}>
                    <PieceCard
                      piece={p}
                      plain
                      draft={segments[segments.length - 1]}
                      video={hasJobs ? project.id : undefined}
                      longformProject={project.id}
                      manage={{ path: project.id, onDone: onManaged }}
                      onChanged={refresh}
                    />
                  </Section>
                ) : (
                  <PieceCard key={p.path} piece={p} startOpen draft={segments[segments.length - 1]} manage={{ path: project.id, onDone: onManaged }} onChanged={refresh} />
                ),
              )}
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
        <PieceCard key={p.path} piece={p} video={video} onChanged={onChanged} manage={{ path: p.path, onDone: onManaged }} />
      ))}
    </Section>
  );
}

/** "V05_Shock" -> "V05 · Shock" */
function versionLabel(name: string): string {
  const [num, ...rest] = name.split('_');
  return rest.length ? `${num} · ${rest.join(' ')}` : num;
}

function NewPackagingVersion({ piece, source, onCreated }: { piece: Piece; source: { name: string; path: string }; onCreated: (name: string) => void }) {
  const next = Math.max(0, ...piece.versions.map((v) => Number(/^V(\d+)/i.exec(v.name)?.[1] ?? 0))) + 1;
  const [name, setName] = useState(`V${String(next).padStart(2, '0')}`);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <details className="new-version"><summary>+ New version</summary>
    <p className="muted small-text">Copy all files and subfolders from {source.name} into a new version. Existing versions stay untouched.</p>
    <label>Version name <input value={name} onChange={(e) => setName(e.target.value)} /></label>{' '}
    <button disabled={busy || !name.trim()} onClick={async () => { setBusy(true); setError(''); try {
      const result = await postJson<{ name: string }>('/api/packaging/copy-version', { piece: piece.path, source: source.path, name }); onCreated(result.name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? 'Copying…' : 'Create version'}</button>
    {error && <p className="error">{error}</p>}
  </details>;
}

function ManagePackagingVersion({ piece, version, onChanged }: { piece: Piece; version: { name: string; path: string }; onChanged: (name?: string) => void }) {
  const [name, setName] = useState(version.name); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <details className="new-version"><summary>Manage version</summary>
    <p className="muted small-text">These actions affect only packaging version {version.name}, not the video or Short.</p>
    <label>Version name <input value={name} onChange={(e) => setName(e.target.value)} /></label>{' '}
    <button disabled={busy || !name.trim() || name === version.name} onClick={async () => {
      if (!window.confirm(`Rename packaging version ${version.name} to ${name}?`)) return;
      setBusy(true); setError(''); try { const result = await postJson<{ name: string }>('/api/packaging/rename-version', { piece: piece.path, source: version.path, name }); onChanged(result.name); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>Rename version</button>{' '}
    <button className="danger-outline" disabled={busy} onClick={async () => {
      if (!window.confirm(`Move packaging version ${version.name} and all its files to HeartQuarters Trash? The video and other versions will remain.`)) return;
      setBusy(true); setError(''); try { await postJson('/api/packaging/trash-version', { piece: piece.path, source: version.path }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>Delete version</button>
    {error && <p className="error">{error}</p>}
  </details>;
}

function ThumbnailPlanning({ doc }: { doc: import('./PackagingDoc').LoadedDoc }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (doc.text === null || !doc.fields || addThumbnailPlanningFields(doc.text) === doc.text) return null;
  return <div className="thumbnail-planning"><button className="small" disabled={busy} onClick={async () => {
    setBusy(true); setError(''); try { await doc.save(addThumbnailPlanningFields); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }}>Add thumbnail planning fields</button><span className="muted small-text"> Add thumbnail text and idea to {doc.file.name}.</span>{error && <p className="error">{error}</p>}</div>;
}

/** Starts CapCut and copies the project's name. CapCut can't be told which project to open, so that step is John's. */
function OpenInCapCut({ draft }: { draft: string }) {
  const [message, setMessage] = useState<{ text: string; failed?: boolean } | null>(null);
  return (
    <>
      <button
        className="small"
        title={`Starts CapCut and copies "${draft}"`}
        onClick={() => {
          setMessage(null);
          postJson('/api/capcut/open', { draft }).then(
            async () => {
              const copied = await copyText(draft);
              setMessage({
                text: copied
                  ? `CapCut is starting. "${draft}" is copied: paste it into the search box above its Projects list.`
                  : `CapCut is starting. Look for "${draft}" in its Projects list.`,
              });
            },
            (e: Error) => setMessage({ text: e.message, failed: true }),
          );
        }}
      >
        Open CapCut
      </button>
      {message && <span className={`capcut-message small-text ${message.failed ? 'error' : 'muted'}`}>{message.text}</span>}
    </>
  );
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

/** "✓ exported · packaging V01" */
function pieceSummary(piece: Piece): string {
  return (
    (piece.exports.length > 0 ? '✓ exported' : 'not exported') +
    (piece.packagingVersion
      ? ` · packaging ${versionLabel(piece.packagingVersion)}` + (piece.versions.length > 1 ? ` (${piece.versions.length} versions)` : '')
      : ' · no packaging')
  );
}

/** A part of a video's page that folds away, and stays as it was left. */
function Section({
  name,
  title,
  count,
  detail,
  children,
}: {
  name: string;
  title: string;
  count?: number;
  /** A few words beside the title, such as whether it's been exported. */
  detail?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => rememberedOpen(name));
  const { focus } = useContext(StatusContext);
  useEffect(() => { if (name === 'shorts' && focus) setOpen(true); }, [name, focus]);
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
        {detail && <span className="muted section-detail"> {detail}</span>}
      </summary>
      {children}
    </details>
  );
}

function PieceCard({
  piece,
  startOpen = false,
  plain = false,
  draft,
  video,
  longformProject,
  onChanged,
  manage,
}: {
  piece: Piece;
  startOpen?: boolean;
  /** Inside a section that folds away by itself, so it has no heading or arrow of its own. */
  plain?: boolean;
  /** Its CapCut project's name, if it isn't called the same as the piece. */
  draft?: string;
  /** The video's id when AI jobs can run on this piece: not for a standalone short or a reel. */
  video?: string;
  /** The long-form's project, used to find its saved YouTube link. */
  longformProject?: string;
  /** Called when something changed in the folders, such as a new packaging version. */
  onChanged?: () => void;
  /** What Rename and Delete act on: the whole video for its longform or a standalone short, else the piece itself. */
  manage?: { path: string; onDone: (result: ManageResult) => void };
}) {
  const [versionName, setVersionName] = useState(piece.packagingVersion);
  const version = piece.versions.find((v) => v.name === versionName) ?? piece.versions.at(-1);
  const latest = piece.versions.at(-1)?.name;
  const [docsLoads, setDocsLoads] = useState(0);
  const docs = usePackagingDocs(version?.docs ?? [], docsLoads);
  const [open, setOpen] = useState(startOpen);
  const { focus } = useContext(StatusContext);
  const card = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (focus === piece.path) { setOpen(true); card.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, [focus, piece.path]);

  const reloadDocs = () => {
    setDocsLoads((n) => n + 1);
    onChanged?.();
  };
  // Every card has the same layout, top to bottom: the AI box, then the thumbnail beside YouTube's fields, the
  // description, YouTube's upload and settings, and last the other platforms.
  const contents = (
    <>
      {piece.kind !== 'reel' && (
        <PieceAI
          video={video}
          piece={piece.kind === 'longform' ? 'Longform' : piece.name}
          draft={draft ?? piece.name}
          canEdit={piece.kind === 'longform'}
          onFinished={reloadDocs}
        />
      )}
      {piece.kind !== 'reel' && <PieceStatus path={piece.path} details />}

      {/* Two columns: thumbnails, exports and versions on the left; text on the right. */}
      <div className={`piece-body${piece.kind === 'short' ? ' piece-body--short' : ''}`}>
        <div className="piece-media">
          <VideoPreview key={piece.path} exports={piece.exports} covers={version?.covers ?? []} />
          {version && <ThumbnailImport key={version.path} piece={piece.path} version={version.path} onSaved={() => onChanged?.()} />}

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
              <NewPackagingVersion key={version.path} piece={piece} source={version} onCreated={(name) => { setVersionName(name); onChanged?.(); }} />
              <ManagePackagingVersion key={`manage-${version.path}`} piece={piece} version={version} onChanged={(name) => { setVersionName(name ?? piece.versions.find((v) => v.path !== version.path)?.name ?? ''); onChanged?.(); }} />
            </div>
          )}

          <div className="versions piece-actions">
            {piece.kind !== 'reel' && <OpenInCapCut draft={draft ?? piece.name} />}
            <button className="small" onClick={() => openInExplorer('projects', piece.path)}>Open folder</button>
            {version && <button className="small" onClick={() => openInExplorer('projects', version.path)}>Open {versionLabel(version.name)} folder</button>}
            {manage && <ManageButtons path={manage.path} onDone={manage.onDone} />}
          </div>
        </div>

        <div className="piece-docs">
          {!version && <p className="muted">No packaging yet.</p>}
          {version && version.docs.length === 0 && <p className="muted">No text files in this version.</p>}
          {docs.slice(0, 1).map((d) => (
            <PackagingDocShort key={d.file.path} doc={d} />
          ))}
          {docs.filter((d) => /^youtube(?:\b|[_. -])/i.test(d.file.name.split('/').pop() ?? '')).map((d) => <ThumbnailPlanning key={d.file.path} doc={d} />)}
        </div>
      </div>

      {/* The main file's Description runs full width under both columns. */}
      <PackagingDocsWide docs={docs} />
      {piece.kind !== 'reel' && <YouTubeUpload piece={piece} docs={docs} covers={version?.covers ?? []} version={version?.path} onChanged={onChanged} longform={piece.kind === 'short' ? video : undefined} longformProject={longformProject} />}
      <PackagingOtherPlatforms docs={docs} />
    </>
  );

  if (plain) return <div className="card">{contents}</div>;
  return (
    <details ref={card} className="card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="piece-name">{piece.name}</span>
        <span className="muted">{pieceSummary(piece)}</span>
        {piece.kind !== 'reel' && <PieceStatus path={piece.path} />}
      </summary>
      {contents}
    </details>
  );
}
