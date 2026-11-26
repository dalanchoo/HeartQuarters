import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { SidebarResizer } from './SidebarResizer';
import {
  copyText,
  formatSize,
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
import { CleanUp } from './CleanUp';
import { AboutVideoSection } from './AboutVideoSection';
import { ScriptSection } from './ScriptSection';
import { ShortsPlanCard } from './ShortsPlan';
import { VideoSteps } from './VideoSteps';
import { NewFolderButton } from './NewFolder';
import { lockDocs, PackagingDocShort, PackagingDocsWide, PackagingOtherPlatforms, usePackagingDocs } from './PackagingDoc';
import { localValue } from './youtubePackaging';
import { PieceAI } from './PieceAI';
import { quotaUsedUp, units, useYoutubeQuota } from './youtubeQuota';
import { VersionNotes } from './VersionNotes';
import { DraftsSection } from './DraftsSection';
import { YouTubeLinkBar, useYoutubeLink } from './YouTubeCard';
import { YouTubeIcon } from './YouTubeOpenLink';
import { VideoPreview } from './VideoPreview';
import { PackagingChoice, PackagingCompare } from './PackagingCompare';
import { LockSwitch } from './LockSwitch';
import { YOUTUBE_SELECTION } from './comparisonSelection';
import { hasPendingEdits } from './unsavedEdits';
import { ThumbnailImport } from './ThumbnailImport';
import type { VideoOverview } from '../../server/video-overview';
import type { CleanupStatus } from '../../server/cleanup-status';
import type { YoutubeChecks } from './videoChecks';
import { checkYoutubeVideo } from './videoChecks';
import type { CommentCheck } from '../../server/youtube-comment';
import type { YoutubeVideoSettings } from '../../server/youtube-video';
import { matchesProjectSearch, matchesVideoSearch } from './videoSearch';

type Filter = 'all' | 'no-capcut' | 'not-exported' | 'no-metadata' | 'no-thumbnail' | 'not-uploaded' | 'different' | 'no-comment' | 'clean-up';
const FILTER_LABELS: Record<Filter, string> = { all: 'All Videos', 'no-capcut': 'No CapCut Project', 'not-exported': 'Not Exported', 'no-metadata': 'Metadata Incomplete', 'no-thumbnail': 'No Thumbnail', 'not-uploaded': 'Not Uploaded', different: 'Problems on YouTube', 'no-comment': 'No Comment Posted', 'clean-up': 'Can Clean Up' };
/** The Show menu's choices, drawn with the YouTube icon where YouTube is meant. */
const showFilter = (value: string) => value === 'different' ? <>Problems on <YouTubeIcon /></> : FILTER_LABELS[value as Filter];
const StatusContext = createContext<{ items: VideoOverview[]; checks: Record<string, YoutubeChecks>; focus: string | null; cleanup: CleanupStatus['pieces'] }>({ items: [], checks: {}, focus: null, cleanup: {} });
function shortFocus(): string | null { const [, , piece] = location.hash.slice(1).split('/'); try { return piece ? decodeURIComponent(piece) : null; } catch { return null; } }
/**
 * After Check Linked Videos on YouTube: something to fix on YouTube itself (an empty title or description, no tags,
 * no custom thumbnail, only automatic captions, or a longform without chapters).
 */
function problemsOnYoutube(item: VideoOverview, checks: Record<string, YoutubeChecks>): boolean { return !!checks[item.path]?.issues.length; }
/** Whether Clean Up has files for this video (for a longform, also Make Shorts' plan and graphs). */
function canCleanUp(item: VideoOverview, cleanup: CleanupStatus['pieces']): boolean {
  return (cleanup[item.path]?.files ?? 0) > 0 || (item.kind === 'longform' && (cleanup[`${item.projectId}/Shorts`]?.files ?? 0) > 0);
}
function matchesFilter(item: VideoOverview, checks: Record<string, YoutubeChecks>, filter: Filter, cleanup: CleanupStatus['pieces'] = {}): boolean {
  switch (filter) {
    case 'all': return true;
    case 'no-capcut': return !item.capcut;
    case 'not-exported': return !item.exported;
    case 'no-metadata': return item.metadataMissing.length > 0;
    case 'no-thumbnail': return !item.localThumbnail;
    case 'not-uploaded': return item.link !== 'linked';
    case 'different': return problemsOnYoutube(item, checks);
    case 'no-comment': return !!checks[item.path]?.issues.includes('no comment posted');
    case 'clean-up': return canCleanUp(item, cleanup);
  }
}
/**
 * Can Clean Up: Clean Up has files for this piece (for a longform, also Make Shorts' plan and graphs). Clean Up Blocked:
 * a CapCut project of the video links to a file that isn't there, so nothing can be listed until it's fixed.
 */
function cleanupParts(item: VideoOverview, cleanup: CleanupStatus['pieces']): [string, NonNullable<CleanupStatus['pieces'][string]>][] {
  const parts: [string, NonNullable<CleanupStatus['pieces'][string]>][] = [];
  const own = cleanup[item.path];
  if (own) parts.push([item.kind === 'longform' ? 'Longform' : 'This Short', own]);
  const plan = item.kind === 'longform' ? cleanup[`${item.projectId}/Shorts`] : undefined;
  if (plan) parts.push(['Make Shorts', plan]);
  return parts;
}
/** Whether CleanupBadge shows anything: missing links, or files Clean Up would move. */
const hasCleanup = (parts: ReturnType<typeof cleanupParts>) => parts.some(([, p]) => p.missing > 0 || p.files > 0);
function CleanupBadge({ item }: { item: VideoOverview }) {
  const { cleanup } = useContext(StatusContext);
  const parts = cleanupParts(item, cleanup);
  const missing = Math.max(0, ...parts.map(([, p]) => p.missing));
  if (missing) return <span className="status-pill status-review" title={`The CapCut projects have ${missing} missing ${missing === 1 ? 'link' : 'links'}. Fix ${missing === 1 ? 'it' : 'them'} in CapCut before cleaning up.`}>Clean Up Blocked</span>;
  const withFiles = parts.filter(([, p]) => p.files > 0);
  if (!withFiles.length) return null;
  return <span className="status-pill status-clean" title={`Clean Up would move to Trash: ${withFiles.map(([name, p]) => `${name}: ${p.files} ${p.files === 1 ? 'file' : 'files'} (${formatSize(p.bytes)})`).join('; ')}`}>Can Clean Up</span>;
}
function shortReachDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso.slice(0, 10);
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' });
}
function formatReachRange(from: string | null | undefined, to: string | null | undefined): string {
  const start = shortReachDate(from);
  const end = shortReachDate(to);
  if (!start) return end;
  return !end || start === end ? start : `${start}–${end}`;
}
/** The newest downloaded stats, lifetime to date for views and % viewed, plus CTR over its reach-report dates. */
function StatsPill({ stats }: { stats: NonNullable<VideoOverview['stats']> }) {
  const whole = new Intl.NumberFormat('en-US');
  const reachRange = formatReachRange(stats.reachFrom, stats.reachTo);
  const ctr = stats.ctrPercent === null ? null : `${stats.ctrPercent.toFixed(1)}% CTR${reachRange ? `, ${reachRange}` : ''}`;
  const parts = [stats.views === null ? null : `${whole.format(stats.views)} ${stats.views === 1 ? 'view' : 'views'}`,
    stats.averageViewPercent === null ? null : `${Math.round(stats.averageViewPercent)}% viewed`,
    ctr].filter(Boolean);
  if (!parts.length) return null;
  const when = stats.downloadedAt ? new Date(stats.downloadedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : stats.snapshot;
  const ctrNote = stats.ctrPercent !== null && stats.impressions !== null
    ? ` CTR is from ${whole.format(stats.impressions)} impressions${reachRange ? ` (${reachRange})` : ''}.`
    : '';
  return <span className="status-pill status-stats" title={`Lifetime to date for views and % viewed, from the stats downloaded ${stats.downloadedAt ? new Date(stats.downloadedAt).toLocaleString() : stats.snapshot}.${ctrNote} Open this video in Channel for analysis.`}>{parts.join(' · ')} <span className="status-stats-date">({when})</span></span>;
}
function StatusBadges({ item, checks }: { item?: VideoOverview; checks?: YoutubeChecks }) {
  const { cleanup } = useContext(StatusContext);
  if (!item) return null;
  // First line: the steps bar (CapCut, Exported, Metadata, Thumbnail, Uploaded) and the latest views. Second line, only
  // when there is something: smaller notes worth a look (missing metadata, problems on YouTube, files to clean up).
  const notes = [item.metadataMissing.length > 0 && item.metadataMissing.length < 8, item.link === 'unknown', !!checks?.issues.length, !!checks?.unknown.length, hasCleanup(cleanupParts(item, cleanup))].some(Boolean);
  return <span className="status-badges"><span className="status-main"><VideoSteps item={item} />{item.stats && <StatsPill stats={item.stats} />}</span>{notes && <span className="status-notes">{item.metadataMissing.length > 0 && item.metadataMissing.length < 8 && <span className="status-pill status-review" title="The newest packaging version's YouTube text is missing these. Add them in View and Compare Packaging.">Missing: {item.metadataMissing.join(', ')}</span>}{item.link === 'unknown' && <span className="status-pill status-unknown" title="The saved link status could not be determined.">YT Unknown</span>}{checks && checks.issues.length > 0 && <span className="status-pill status-review" title="Found by Check Linked Videos on YouTube: something to fix on YouTube itself." aria-label={`On YouTube: ${checks.issues.join(', ')}`}>On <YouTubeIcon />: {checks.issues.join(', ')}</span>}{checks && checks.unknown.length > 0 && <span className="status-pill status-unknown" title={`YouTube could not confirm: ${checks.unknown.join('; ')}`}>Check Incomplete</span>}<CleanupBadge item={item} /></span>}</span>;
}
function PieceStatus({ path, details = false }: { path: string; details?: boolean }) {
  const { items, checks } = useContext(StatusContext);
  const item = items.find((entry) => entry.path === path); if (!item) return null;
  const checked = checks[path];
  // In the YouTube section (details) the badges are already on the title just above, so only the explanation shows.
  return <span className="piece-status">{!details && <StatusBadges item={item} checks={checked} />}{details && <span className="status-explanation">{item.localThumbnail ? 'Local thumbnail found' : 'No local thumbnail in latest version'}{checked ? ` · YouTube: ${checked.issues.length ? checked.issues.join(', ') : 'no checked issues'}${checked.unknown.length ? `; not confirmed: ${checked.unknown.join(', ')}` : ''}` : ' · YouTube details not checked yet'}</span>}</span>;
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
  // A newly picked video opens at the top of the right panel, not wherever the last one was scrolled to.
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }); }, [selected]);
  const [error, setError] = useState<string | null>(null);
  // Goes up by one after a new folder is made, so the list and the page re-read the disk.
  const [reloads, setReloads] = useState(0);
  // The note shown after making, renaming or deleting a folder.
  const [note, setNote] = useState<Note | null>(null);
  const [overview, setOverview] = useState<VideoOverview[]>([]);
  const [overviewError, setOverviewError] = useState('');
  const [checks, setChecks] = useState<Record<string, YoutubeChecks>>({});
  const [cleanup, setCleanup] = useState<CleanupStatus['pieces']>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<string | null>(shortFocus);
  const [scan, setScan] = useState(''); const [scanning, setScanning] = useState(false);
  const scanEpoch = useRef(0);
  const quota = useYoutubeQuota();

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const lastVideoHash = useRef(location.hash);
  useEffect(() => {
    getJson<ProjectNode[]>('/api/projects').then(setProjects, (e) => setError(e.message));
  }, [reloads]);

  useEffect(() => {
    // Another tab's address isn't for this page: it stays as it was while hidden.
    const onHash = () => {
      if (!/^#(Videos|Projects)(\/|$)/.test(location.hash)) return;
      const next = projectFromHash();
      if (next !== selectedRef.current && hasPendingEdits() && !window.confirm('You have unsaved changes on this project. Discard them and open another project?')) {
        history.replaceState(null, '', lastVideoHash.current);
        return;
      }
      lastVideoHash.current = location.hash;
      setSelected(next); setFocus(shortFocus());
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    let active = true;
    const load = () => getJson<VideoOverview[]>('/api/video-overview').then((items) => { if (active) { setOverview(items); setOverviewError(''); } }, (e) => { if (active) setOverviewError(e.message); });
    // Several changes close together (typing in a field saves often) reload the list once, a moment after the last.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 1200); };
    const changed = (event: Event) => { const piece = (event as CustomEvent<string>).detail; if (piece) { scanEpoch.current++; setChecks((old) => { const next = { ...old }; delete next[piece]; return next; }); } soon(); };
    const checked = (event: Event) => { const { path, checks: values } = (event as CustomEvent<{ path: string; checks: YoutubeChecks }>).detail; setChecks((old) => ({ ...old, [path]: values })); };
    // Coming back to the window catches changes made elsewhere, like an export from CapCut.
    const back = () => { if (!document.hidden) soon(); };
    void load(); window.addEventListener('hq-video-status-changed', changed); window.addEventListener('hq-youtube-checked', checked); window.addEventListener('focus', back);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('hq-video-status-changed', changed); window.removeEventListener('hq-youtube-checked', checked); window.removeEventListener('focus', back); };
  }, [reloads]);

  // The Can Clean Up badges: the engine answers with its last check and works out a new one in the background, so
  // ask again every few seconds while it's busy, and after a cleanup.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      clearTimeout(timer);
      getJson<CleanupStatus>('/api/cleanup/status').then((s) => {
        if (!active) return;
        setCleanup(s.pieces);
        if (s.busy || s.checkedAt === null) timer = setTimeout(load, 3000);
      }, () => undefined);
    };
    const again = () => { timer = setTimeout(load, 500); };
    load();
    window.addEventListener('hq-cleanup-done', again);
    return () => { active = false; clearTimeout(timer); window.removeEventListener('hq-cleanup-done', again); };
  }, [reloads]);

  async function checkLinkedVideos() {
    const candidates = overview.filter((item) => item.videoId);
    const ambiguous = overview.filter((item) => item.link === 'linked' && !item.videoId).length;
    if (!candidates.length) { setScan('No uniquely linked videos are available to check.'); return; }
    // Title, description, tags, thumbnail and chapters, 50 videos to a YouTube request (about 1 unit each), then whether
    // your own comment is posted (1 unit per video). Captions cost 50 units per video, so they're checked on one
    // video's card instead.
    const epoch = ++scanEpoch.current; let done = 0; let missing = 0; let stopped = '';
    setScanning(true); setScan(`Checking 0 of ${candidates.length}…`);
    for (let i = 0; i < candidates.length && epoch === scanEpoch.current; i += 50) {
      const batch = candidates.slice(i, i + 50);
      try {
        const { videos } = await getJson<{ videos: Record<string, YoutubeVideoSettings> }>(`/api/youtube/check-videos?ids=${batch.map((item) => encodeURIComponent(item.videoId!)).join(',')}`);
        if (epoch !== scanEpoch.current) break;
        const found = batch.filter((item) => videos[item.videoId!]);
        missing += batch.length - found.length;
        // A failed comment check leaves those videos "not confirmed" rather than stopping the whole check.
        const comments = found.length ? await getJson<Record<string, CommentCheck>>(`/api/youtube/own-comments?ids=${found.map((item) => encodeURIComponent(item.videoId!)).join(',')}`).catch(() => ({} as Record<string, CommentCheck>)) : {};
        if (epoch !== scanEpoch.current) break;
        setChecks((old) => ({
          ...old,
          ...Object.fromEntries(batch.map((item) => [item.path, videos[item.videoId!] ? checkYoutubeVideo(videos[item.videoId!], undefined, item.kind === 'short', comments[item.videoId!] ?? null) : { issues: [], unknown: ['YouTube did not return this video'] }])),
        }));
        done += batch.length; setScan(`Checking ${done} of ${candidates.length}…`);
      } catch (e) { stopped = e instanceof Error ? e.message : String(e); break; }
    }
    setScanning(false);
    setScan(epoch !== scanEpoch.current ? 'Check stopped because a video link changed. Run it again to update the list.'
      : stopped ? `Checked ${done} of ${candidates.length}, then stopped: ${stopped}`
      : `Checked ${done} video${done === 1 ? '' : 's'}, without captions (open a video's YouTube Upload & Settings to see its captions).${missing ? ` YouTube did not return ${missing}.` : ''}${ambiguous ? ` ${ambiguous} with multiple saved links need to be checked individually.` : ''}`);
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
    <StatusContext.Provider value={{ items: overview, checks, focus, cleanup }}><div className="split">
      <aside className="sidebar">
        <details className="sidebar-section sidebar-videos" open>
          <summary>Videos</summary>
          <div className="sidebar-filters">
            <div className="sidebar-actions">
              <button className="small" aria-label={scanning ? 'Checking YouTube' : 'Check Linked Videos on YouTube'} title="YouTube checks last for this session; check again after changing Studio." disabled={scanning || !overview.length || quotaUsedUp(quota)} onClick={() => void checkLinkedVideos()}>{scanning ? 'Checking…' : 'Check Linked Videos on'} <YouTubeIcon /></button>
              <span className="muted small-text" style={{ whiteSpace: 'nowrap' }}>{units(Math.max(1, Math.ceil(overview.filter((item) => item.videoId).length / 50)) + overview.filter((item) => item.videoId).length)}</span>
            </div>
            <div className="sidebar-actions">
              <NewFolderButton kind="top" onCreated={onCreated} />
              <NewFolderButton kind="standalone" onCreated={onCreated} />
            </div>
            <span id="video-show-label">Show</span>
            <PackagingChoice name="Show" value={filter} options={Object.keys(FILTER_LABELS)} label={value => FILTER_LABELS[value as Filter]} render={showFilter} onChange={value => setFilter(value as Filter)} />
            <label htmlFor="video-find">Find</label>
            <input id="video-find" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Project name or saved title" />
          </div>
          {scan && <p className="status-legend" role="status">{scan}</p>}
          {overviewError && <p className="error">Video status unavailable: {overviewError}</p>}
          {error && <p className="error">{error}</p>}
          {!projects && !error && <p className="muted">Loading…</p>}
          {projects &&
            ordered(null, projects).map((p) => <TreeItem key={p.id} node={p} selected={selected} filter={filter} search={search} />)}
        </details>
      </aside>
      <SidebarResizer />
      <section className="content" ref={contentRef}>
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
                  Open Folder
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
  const { focus } = useContext(StatusContext);
  return (
    <a href={linkTo(node.id)} className={`project-link ${node.id === selected && !focus ? 'active' : ''}`}>
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
function TreeItem({ node, selected, filter, search }: { node: ProjectNode; selected: string | null; filter: Filter; search: string }) {
  const { items, checks, focus, cleanup } = useContext(StatusContext);
  const relevant = items.filter((item) => item.projectId === node.id || item.projectId.startsWith(`${node.id}/`));
  if (filter !== 'all' && !relevant.some((item) => matchesFilter(item, checks, filter, cleanup))) return null;
  const nodeMatches = matchesProjectSearch(node.id, node.title, search);
  if (search.trim() && !nodeMatches && !relevant.some(item => matchesFilter(item, checks, filter, cleanup) && matchesVideoSearch(item, search))) return null;
  const shorts = node.kind !== 'short' ? items.filter((item) => item.projectId === node.id && item.kind === 'short' && matchesFilter(item, checks, filter, cleanup) && (nodeMatches || matchesVideoSearch(item, search))) : [];
  if (node.children.length === 0 && shorts.length === 0) {
    return (
      <div className="tree-leaf">
        <NodeLink node={node} selected={selected} />
      </div>
    );
  }
  const holdsSelection = !!selected && (selected === node.id || selected.startsWith(node.id + '/'));
  return (
    <details className="tree-node" open={holdsSelection || !!search.trim()}>
      <summary>
        <NodeLink node={node} selected={selected} />
      </summary>
      <div className="tree-children">
        {ordered(node, node.children).map((c) => (
          <TreeItem key={c.id} node={c} selected={selected} filter={filter} search={search} />
        ))}
        {shorts.map((short) => <a key={short.path} href={`${linkTo(node.id)}/${encodeURIComponent(short.path)}`} className={`project-link short-tree-link ${focus === short.path && selected === node.id ? 'active' : ''}`}><span className="title">{short.name}</span></a>)}
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
          <button onClick={() => openInExplorer('projects', project.path)}>Open {project.kind === 'series' ? 'Series' : 'Video'} Folder</button>
          {project.kind === 'series' && <ManageButtons what="Series" path={project.id} onDone={onManaged} />}
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
        <Section name="make-shorts" title="Make Shorts">
          <ShortsPlanCard video={project.id} onChanged={refresh} />
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

/** Sent when a Short's card opens, so the other Shorts' cards and the Longform section close. */
const SHORT_OPENED = 'hq-short-opened';
/** Sent when the Longform section opens, so all Shorts and the Shorts group close. */
const LONGFORM_OPENED = 'hq-longform-opened';

/** "V05_Shock" -> "V05 · Shock" */
function versionLabel(name: string): string {
  const [num, ...rest] = name.split('_');
  return rest.length ? `${num} · ${rest.join(' ')}` : num;
}

// Versions are always V01, V02...: a new one takes the next number, and none is ever renamed.
function NewPackagingVersion({ piece, source, onCreated }: { piece: Piece; source: { name: string; path: string }; onCreated: (name: string) => void }) {
  const next = `V${String(Math.max(0, ...piece.versions.map((v) => Number(/^V(\d+)/i.exec(v.name)?.[1] ?? 0))) + 1).padStart(2, '0')}`;
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <>
    <button className="small" disabled={busy} title={`Copies everything in ${source.name} into a new version, ${next}. Its Notes.md will say it isn't on YouTube yet.`} onClick={async () => { setBusy(true); setError(''); try {
      const result = await postJson<{ name: string }>('/api/packaging/copy-version', { piece: piece.path, source: source.path }); onCreated(result.name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}>{busy ? 'Copying…' : `Clone ${versionLabel(source.name)}`}</button>
    {error && <p className="error">{error}</p>}
  </>;
}

function DeletePackagingVersion({ piece, version, locked, onChanged }: { piece: Piece; version: { name: string; path: string }; locked?: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const isDraft = /^D\d+/i.test(version.name);
  return <>
    <button className="small danger-outline" disabled={busy || locked} onClick={async () => {
      if (!window.confirm(`Delete packaging ${isDraft ? 'draft' : 'version'} ${version.name}? It moves to HeartQuarters Trash with all its files. The video and the other versions stay.`)) return;
      setBusy(true); setError(''); try { await postJson('/api/packaging/trash-version', { piece: piece.path, source: version.path }); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    }}>{busy ? 'Deleting…' : isDraft ? 'Delete Draft' : 'Delete Version'}</button>
    {error && <p className="error">{error}</p>}
  </>;
}

/** Starts CapCut and copies the project's name. CapCut can't be told which project to open, so that step is John's. */
/**
 * At the top of a longform or short with nothing in Exports: export comes first, before the metadata, because
 * uploading to YouTube needs the video file. "Open Exports Folder" makes the folder if it isn't there yet.
 */
function ExportFirst({ piece, draft }: { piece: Piece; draft: string }) {
  const [problem, setProblem] = useState('');
  const openFolder = () => {
    setProblem('');
    postJson('/api/open-exports', { piece: piece.path }).catch((e: Error) => setProblem(e.message));
  };
  return (
    <div className="next-step" role="status">
      <strong>Next Step: Export the {piece.kind === 'short' ? 'Short' : 'Video'}</strong>
      <p>
        There's no video in this {piece.kind === 'short' ? "short's" : "video's"} Exports folder yet. Export it from CapCut into that folder before
        writing the metadata: uploading to YouTube needs the video file, and the Exported step stays empty until then.
      </p>
      <div className="next-step-actions">
        <OpenInCapCut draft={draft} />
        <button className="small" onClick={openFolder}>Open Exports Folder</button>
      </div>
      {problem && <p className="error small-text">{problem}</p>}
    </div>
  );
}

function OpenInCapCut({ draft }: { draft: string }) {
  const [message, setMessage] = useState<{ text: string; failed?: boolean } | null>(null);
  return (
    <>
      <button
        className="small"
        title={`Starts CapCut and copies "${draft}"`}
        onClick={() => {
          setMessage(null);
          postJson<{ name: string }>('/api/capcut/open', { draft }).then(
            async ({ name }) => {
              // The real name: CapCut may have renamed it to "003 - SDAM(1)".
              const copied = await copyText(name);
              setMessage({
                text: copied
                  ? `CapCut is starting. "${name}" is copied: paste it into the search box above its Projects list.`
                  : `CapCut is starting. Look for "${name}" in its Projects list.`,
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

/** The current version (whether it's exported shows in the steps bar; a reel has no bar, so it says so here). */
function pieceSummary(piece: Piece): string {
  return (
    (piece.kind === 'reel' ? (piece.exports.length > 0 ? '✓ exported · ' : 'not exported · ') : '') +
    (piece.packagingVersion
      ? versionLabel(piece.packagingVersion)
      : 'no packaging')
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
  const { focus } = useContext(StatusContext);
  const [open, setOpen] = useState(() => (name === 'longform' && focus ? false : rememberedOpen(name)));
  useEffect(() => {
    if (name === 'shorts' && focus) {
      setOpen(true);
      rememberOpen(name, true);
    }
    if (name === 'longform' && focus) {
      setOpen(false);
      rememberOpen(name, false);
    }
  }, [name, focus]);
  useEffect(() => {
    if (name === 'longform') {
      const close = () => {
        setOpen(false);
        rememberOpen(name, false);
      };
      window.addEventListener(SHORT_OPENED, close);
      return () => window.removeEventListener(SHORT_OPENED, close);
    }
    if (name === 'shorts') {
      const close = () => {
        setOpen(false);
        rememberOpen(name, false);
      };
      window.addEventListener(LONGFORM_OPENED, close);
      return () => window.removeEventListener(LONGFORM_OPENED, close);
    }
  }, [name]);
  return (
    <details
      className="page-section"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setOpen(now);
        rememberOpen(name, now);
        if (now && name === 'longform') window.dispatchEvent(new Event(LONGFORM_OPENED));
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
  const isDraftVersion = (name: string) => /^D\d+/i.test(name);
  const realVersions = piece.versions.filter((v) => !isDraftVersion(v.name));
  const draftVersions = piece.versions.filter((v) => isDraftVersion(v.name));
  const [versionName, setVersionName] = useState(piece.packagingVersion);
  const [compareDirty, setCompareDirty] = useState(false);
  const allowVersionChange = () => !compareDirty || window.confirm('You have unapplied packaging changes. Discard them and change versions?');
  const version = piece.versions.find((v) => v.name === versionName) ?? realVersions.at(-1) ?? piece.versions.at(-1);
  const [compareChoices, setCompareChoices] = useState(() => ({ left: version?.path ?? '', right: YOUTUBE_SELECTION }));
  // Whether View and Compare Packaging is open, kept here too: unlocking a version rebuilds it, and it should stay open.
  const [compareOpen, setCompareOpen] = useState(false);
  // One version at most is unlocked, and it's the selected one: unlocking a version with its switch in View and
  // Compare Packaging selects it and locks every other. Unlocking lasts until the page is reloaded or another version
  // is selected; a version he has just made starts unlocked, since he made it to change it.
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const locked = !!version && unlocked !== version.path;
  const [docsLoads, setDocsLoads] = useState(0);
  const loadedDocs = usePackagingDocs(version?.docs ?? [], docsLoads);
  const docs = locked ? lockDocs(loadedDocs) : loadedDocs;
  const [open, setOpen] = useState(startOpen);
  // One Short open at a time: opening one tells the others (and the Longform) to close; opening Longform closes every Short.
  useEffect(() => {
    if (piece.kind !== 'short') return;
    const other = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== piece.path) setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener(SHORT_OPENED, other);
    window.addEventListener(LONGFORM_OPENED, close);
    return () => {
      window.removeEventListener(SHORT_OPENED, other);
      window.removeEventListener(LONGFORM_OPENED, close);
    };
  }, [piece.path, piece.kind]);
  const { focus } = useContext(StatusContext);
  // The link to YouTube, shared by the status line and Local vs YouTube. Nothing is read while the card is closed.
  const link = useYoutubeLink(piece, longformProject, (plain || open) && piece.kind !== 'reel');
  const finishedUpload = link.job?.status === 'done' && link.job.video ? link.job.id : null;
  const refreshedUpload = useRef<string | null>(null);
  useEffect(() => {
    if (!finishedUpload || finishedUpload === refreshedUpload.current) return;
    refreshedUpload.current = finishedUpload;
    onChanged?.();
  }, [finishedUpload, onChanged]);
  const youtubeDoc = docs.find((d) => version?.docs.some(file => file.path === d.file.path) && /^youtube(?:\b|[_. -])/i.test(d.file.name.split('/').pop() ?? ''));
  const card = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (focus === piece.path) {
      setOpen(true);
      if (piece.kind === 'short') window.dispatchEvent(new CustomEvent(SHORT_OPENED, { detail: piece.path }));
      // Jump (not glide) to the top of this card once other cards have closed, and again once its contents have
      // loaded: a gliding scroll was thrown off when the cards above it changed height, landing mid-card.
      const jump = () => card.current?.scrollIntoView({ block: 'start' });
      const frame = requestAnimationFrame(() => requestAnimationFrame(jump));
      const later = window.setTimeout(jump, 400);
      return () => { cancelAnimationFrame(frame); window.clearTimeout(later); };
    }
  }, [focus, piece.path, piece.kind]);

  // For the question John pastes into vidIQ and Ask Studio: the title and what it's about, from YouTube.md.
  const videoId = link.job?.status === 'done' ? link.job.videoId : undefined;
  const research = (() => {
    const text = youtubeDoc?.text ?? '';
    const read = (label: 'Title' | 'Description') => {
      try {
        return localValue(text, label) ?? '';
      } catch {
        return '';
      }
    };
    const about = read('Description').split(/\n\s*\n/)[0] ?? '';
    const short = piece.kind === 'short';
    return { title: read('Title'), about, short, videoId, url: videoId ? (short ? `https://youtube.com/shorts/${videoId}` : `https://youtube.com/watch?v=${videoId}`) : undefined };
  })();

  const reloadDocs = () => {
    setDocsLoads((n) => n + 1);
    onChanged?.();
  };
  const toggleLock = (path: string) => {
    const v = piece.versions.find(x => x.path === path);
    if (!v || !version) return;
    if (compareDirty && !window.confirm(`You have unapplied changes to ${versionLabel(version.name)}. Discard them and ${unlocked === path ? 'lock it' : `unlock ${versionLabel(v.name)} instead`}?`)) return;
    setCompareDirty(false);
    if (unlocked === path) { setUnlocked(null); return; }
    setVersionName(v.name);
    setUnlocked(path);
  };
  // Every card has 10 collapsible sections, top to bottom:
  // 1. YouTube, 2. About This Video, 3. Script, 4. Versions (open by default), 5. Generate Video, 6. Generate Packaging,
  // 7. View and Compare Packaging, 8. Analysis, 9. Other Platforms, 10. Clean Up.
  const contents = (
    <>
      {piece.kind !== 'reel' && !piece.exports.length && <ExportFirst piece={piece} draft={draft ?? piece.name} />}
      {piece.kind !== 'reel' && (
        <details className="yt-section">
          <summary aria-label="YouTube" title="YouTube"><YouTubeIcon /></summary>
          <PieceStatus path={piece.path} details />
          <YouTubeLinkBar piece={piece} link={link} />
        </details>
      )}
      {piece.kind !== 'reel' && <AboutVideoSection key={`about-${piece.path}`} piece={piece.path} />}
      {piece.kind !== 'reel' && <ScriptSection key={`script-${piece.path}`} piece={piece.path} onSaved={reloadDocs} />}

      <details className="yt-section" open>
        <summary>Versions</summary>
        {/* Two columns: the video on the left; its versions, notes and folder buttons on the right. */}
        <div className={`piece-body${piece.kind === 'short' ? ' piece-body--short' : ''}`}>
          <div className="piece-media">
            <VideoPreview key={piece.path} exports={piece.exports} covers={version?.covers ?? []} />
            <div className="versions piece-actions">
              {piece.kind !== 'reel' && <OpenInCapCut draft={draft ?? piece.name} />}
              <button className="small" onClick={() => openInExplorer('projects', piece.path)}>Open {piece.kind === 'short' ? 'Short' : 'Video'} Folder</button>
              {manage && <ManageButtons what={manage.path === piece.path && piece.kind === 'short' ? 'Short' : 'Video'} path={manage.path} onDone={manage.onDone} />}
            </div>
          </div>

          <div className="piece-docs">
            {version && <ThumbnailImport key={version.path} piece={piece.path} version={version.path} versions={piece.versions} locked={locked} onSaved={() => onChanged?.()} />}
            {!version && <div><p className="muted">No packaging yet.</p><button onClick={() => { void postJson<{ name: string; path: string }>('/api/packaging/first-version', { piece: piece.path }).then(result => { setVersionName(result.name); setUnlocked(result.path); onChanged?.(); }, e => window.alert(e instanceof Error ? e.message : String(e))); }}>Create V01</button></div>}
            {version && (() => {
              const isDraft = isDraftVersion(version.name);
              const versionButtons = (items: typeof piece.versions) => (
                <div className="versions">
                  {items.map((v) => (
                    <div key={v.path} className="version-choice">
                      <button className={`version small ${v.name === version.name ? 'active' : ''}`} onClick={() => { if (v.name === version.name) return; if (!allowVersionChange()) return; setCompareDirty(false); setVersionName(v.name); setUnlocked(null); }}>
                        {versionLabel(v.name)}
                      </button>
                    </div>
                  ))}
                </div>
              );
              return (
                <>
                  {realVersions.length > 0 && (
                    <details className="yt-section version-drafts" open>
                      <summary>Versions ({realVersions.length})</summary>
                      {versionButtons(realVersions)}
                      {!isDraft && (
                        <>
                          <div className="versions version-actions">
                            <button className="small" onClick={() => openInExplorer('projects', version.path)}>Open {versionLabel(version.name)} Folder</button>
                            <DeletePackagingVersion key={`delete-${version.path}`} piece={piece} version={version} locked={locked} onChanged={() => { setUnlocked(null); setVersionName(realVersions.find((v) => v.path !== version.path)?.name ?? piece.versions.find((v) => v.path !== version.path)?.name ?? ''); onChanged?.(); }} />
                            <NewPackagingVersion key={version.path} piece={piece} source={version} onCreated={(name) => { setVersionName(name); setUnlocked(version.path.replace(/[^/]+$/, name)); onChanged?.(); }} />
                            <LockSwitch locked={locked} name={versionLabel(version.name)} onToggle={() => toggleLock(version.path)} />
                          </div>
                          <VersionNotes key={`notes-${version.path}`} version={version} locked={locked} />
                        </>
                      )}
                    </details>
                  )}
                  {draftVersions.length > 0 && (
                    <details className="yt-section version-drafts" open={realVersions.length === 0 || undefined}>
                      <summary>Drafts ({draftVersions.length})</summary>
                      {versionButtons(draftVersions)}
                      {isDraft && (
                        <>
                          <div className="versions version-actions">
                            <button className="small" onClick={() => openInExplorer('projects', version.path)}>Open {versionLabel(version.name)} Folder</button>
                            <DeletePackagingVersion key={`delete-${version.path}`} piece={piece} version={version} locked={locked} onChanged={() => { setUnlocked(null); setVersionName(realVersions.find((v) => v.path !== version.path)?.name ?? piece.versions.find((v) => v.path !== version.path)?.name ?? ''); onChanged?.(); }} />
                            <LockSwitch locked={locked} name={versionLabel(version.name)} onToggle={() => toggleLock(version.path)} />
                          </div>
                          <VersionNotes key={`notes-${version.path}`} version={version} locked={locked} />
                        </>
                      )}
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </details>

      {piece.kind !== 'reel' && (
        <details className="yt-section">
          <summary>Generate Video</summary>
          <PieceAI
            video={video}
            piece={piece.kind === 'longform' ? 'Longform' : piece.name}
            draft={draft ?? piece.name}
            canEdit={piece.kind === 'longform'}
            onFinished={reloadDocs}
          />
        </details>
      )}

      {piece.kind !== 'reel' && <DraftsSection key={piece.path} piece={piece.path} drafts={piece.drafts} target={version ? { name: versionLabel(version.name), path: version.path, locked } : undefined} research={research} onChanged={reloadDocs} />}
      {version && youtubeDoc && piece.kind !== 'reel' ? (
        <PackagingCompare key={`${version.path}|${unlocked ?? ''}`} piece={piece} version={version} doc={youtubeDoc} locked={locked} unlocked={unlocked} onToggleLock={toggleLock} link={link} onChanged={onChanged} longform={piece.kind === 'short' ? video : undefined} onDirtyChange={setCompareDirty} choices={compareChoices} setChoices={setCompareChoices} open={compareOpen} setOpen={setCompareOpen} />
      ) : (
        <details className="yt-section">
          <summary>View and Compare Packaging</summary>
          {version && version.docs.length === 0 && <p className="muted">No text files in this version.</p>}
          {docs.slice(0, 1).map((d) => (
            <PackagingDocShort key={d.file.path} doc={d} />
          ))}
          <PackagingDocsWide docs={docs} />
        </details>
      )}
      <PackagingOtherPlatforms docs={docs} />
      {piece.kind !== 'reel' && <CleanUp piece={piece.path} onDone={onChanged} />}
    </>
  );

  if (plain) return <div className="card">{contents}</div>;
  return (
    <details
      ref={card}
      className={`card piece-card${piece.kind === 'short' ? ' short-row' : ''}`}
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        if (now === open) return;
        setOpen(now);
        if (now && piece.kind === 'short') window.dispatchEvent(new CustomEvent(SHORT_OPENED, { detail: piece.path }));
      }}
    >
      <summary>
        <span className="piece-name">{piece.name}</span>
        <span className="muted">{pieceSummary(piece)}</span>
        {piece.kind !== 'reel' && <PieceStatus path={piece.path} />}
      </summary>
      {contents}
    </details>
  );
}
