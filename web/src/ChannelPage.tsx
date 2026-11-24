import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { ChannelVideo, ChannelVideoList } from '../../server/channel-videos';
import type { Angle, Topic, VideoProfile } from '../../server/video-profile';
import type { EndScreenData, EndScreenElement } from '../../server/youtube-end-screens';
import { ANGLE_LABELS, TOPIC_LABELS } from './videoProfile';
import { channelKindLabel, channelRows, formatMinutes, longformLabel, rowName, videoProjectsHash, type RowFilters, type SortKey } from './channelRows';
import type { channelOverview, channelVideoDetail, refreshChannelWorkspace } from '../../server/channel-workspace';
import type { CommentsSyncResult, StoredCommentsSummary } from '../../server/channel-comments';
import { AnalyticsAnalysis } from './AnalyticsAnalysis';
import { ReachSetup } from './ReachSetup';
import { SidebarResizer } from './SidebarResizer';
import { VideoPreview } from './VideoPreview';
import { ALL_VIDEO_FACETS, ALL_VIDEO_FILTERS, VideoFacetControls, VideoFilterBar } from './VideoFinder';

type Overview = NonNullable<ReturnType<typeof channelOverview>>;
const videoHash = (id: string) => `#Channel/Video/${encodeURIComponent(id)}`;
const allVideoFacets = ALL_VIDEO_FACETS;
const allVideoResults = ALL_VIDEO_FILTERS;

export function ChannelVideoBrowser({ videos, id }: { videos?: ChannelVideo[]; id?: string }) {
  const [filters, setFilters] = useState(allVideoResults);
  const catalog = videos ?? [];
  const matching = channelRows(catalog, filters, 'publishedAt', true);
  const filtering = filters.kind !== 'all' || filters.topic !== 'all' || filters.angle !== 'all' || !!filters.text;
  const selected = matching.find(video => video.id === id);
  const openId = id && /^[\w-]{11}$/.test(id) && (!filtering || selected) ? id : undefined;
  const applyFilters = (next: typeof allVideoResults) => {
    setFilters(next);
    if (openId && !channelRows(selected ? [selected] : [], next, 'publishedAt', true).length) {
      window.location.replace('#Channel/Video');
    }
  };

  return <div className="channel-video-browser">
    <aside aria-label="Video Browser" className="channel-video-sidebar">
      <VideoFilterBar filters={filters} onChange={applyFilters} />
      <p className="muted small-text" role="status">
        {videos ? `${matching.length} ${filtering ? 'Matching ' : ''}${matching.length === 1 ? 'Video' : 'Videos'}` : 'Use Refresh YouTube Data to load the video list.'}
      </p>
      <nav aria-label="Matching Videos" className="channel-video-list">
        {matching.map(video => <a className={`project-link${video.id === openId ? ' active' : ''}`} key={video.id} href={videoHash(video.id)}
          aria-current={video.id === openId ? 'page' : undefined} title={video.title}>{rowName(video)}</a>)}
      </nav>
    </aside>
    <SidebarResizer />
    <div className="channel-video-detail">
      {openId ? <ChannelVideoView key={openId} id={openId} video={selected} /> : matching.length > 0
        ? <p className="muted">{filters.topic === 'all' ? 'Choose a video from the list.' : `Choose a video about ${TOPIC_LABELS[filters.topic]} from the list.`}</p>
        : filtering && <p className="muted">No videos match these filters.</p>}
    </div>
  </div>;
}

function ChannelPerformance({ overview }: { overview: Overview }) {
  const [periodName, setPeriodName] = useState('Last 28 Days');
  const period = overview.periods.find(item => item.name === periodName) ?? overview.periods[0];
  return <section className="channel-performance">
    <div className="yt-linkbar-row">
      <h2>Channel Performance</h2>
      <select aria-label="Channel Performance Period" value={period?.name ?? ''} onChange={e => setPeriodName(e.target.value)}>
        {overview.periods.map(item => <option key={item.name}>{item.name}</option>)}
      </select>
      <span className="muted small-text">{period && `${period.start} to ${period.end} · `}Updated {new Date(overview.downloadedAt).toLocaleString()}</span>
    </div>
    <dl className="channel-metrics">
      <div><dt>Views</dt><dd>{period?.views?.toLocaleString() ?? '–'}</dd></div>
      <div><dt>Watch Time</dt><dd>{period?.watchHours == null ? '–' : formatMinutes(period.watchHours * 60)}</dd></div>
      <div><dt>Impressions</dt><dd>{overview.reach?.impressions.toLocaleString() ?? '–'}</dd></div>
      <div><dt>Thumbnail CTR</dt><dd>{overview.reach?.ctrPercent == null ? '–' : `${overview.reach.ctrPercent.toFixed(1)}%`}</dd></div>
    </dl>
    <p className="muted small-text">{overview.reach ? `Reach reports cover ${overview.reach.from.slice(0, 10)} to ${overview.reach.to.slice(0, 10)}. The period picker applies to views and watch time.${overview.reachTruncated ? ' Some reach rows are missing.' : ''}` : overview.reachNote}</p>
  </section>;
}

function ChannelVideoView({ id, video }: { id: string; video?: ChannelVideo }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof channelVideoDetail>>>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    getJson<NonNullable<typeof detail>>(`/api/channel/video?id=${encodeURIComponent(id)}`).then(result => {
      if (active) setDetail(result);
    }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [id, video?.piece]);
  const piece = detail?.piece ?? video?.piece;
  const thumbnail = video?.thumbnail && /^https:\/\/i\.ytimg\.com\//.test(video.thumbnail) ? video.thumbnail : undefined;
  const poster = thumbnail && video ? { src: thumbnail, alt: `Published thumbnail for ${video.title}` } : undefined;
  return <section className="channel-video-view">
    <div className="yt-linkbar-row"><h2>{rowName({ piece: piece ?? null, title: video?.title ?? 'Video Detail' })}</h2>
      {piece && <a href={videoProjectsHash(piece)}>Open in Video Projects ↗</a>}
      <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">Watch on YouTube ↗</a>
    </div>
    <details className="yt-section" open>
      <summary>Published Packaging</summary>
      {video ? <p>{video.title}</p> : <p className="muted">Refresh YouTube Data to show the published title and thumbnail.</p>}
      {(poster || !!detail?.exports.length) && <div className={`channel-video-preview${video?.kind === 'short' ? ' channel-video-preview--short' : ''}`}>
        <VideoPreview exports={detail?.exports ?? []} covers={[]} poster={poster} />
      </div>}
      {detail && !detail.exports.length && <p className="muted small-text">No local video export is available.</p>}
    </details>
    <details className="yt-section">
      <summary>{detail?.transcript?.source === 'script' ? 'Script' : 'Transcript'}</summary>
      {detail?.transcript ? <div className="channel-transcript">{detail.transcript.text.split(/\r?\n[ \t]*\r?\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <p className="muted">{detail ? 'No local transcript or script is available.' : error ? 'The transcript could not be loaded.' : 'Loading transcript…'}</p>}
    </details>
    {error && <p className="error" role="alert">{error}</p>}
    {piece ? <AnalyticsAnalysis key={piece} piece={piece} videoId={id} /> : detail && <p>Link this video in Video Projects to run a detailed analysis.</p>}
  </section>;
}

// The Channel tab: every video on the YouTube channel with its lifetime numbers, plus John's own Topic, Angle and note
// for each video (the same record as About This Video in Video Projects, saved in that video's Drive folder). The list is a saved copy; Refresh asks YouTube again.
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Project' },
  { key: 'publishedAt', label: 'Published' },
  { key: 'views', label: 'Views' },
  { key: 'searchViews', label: 'Search Views' },
  { key: 'browseViews', label: 'Browse Views' },
  { key: 'minutesWatched', label: 'Watch Time' },
  { key: 'averageViewPercentage', label: 'Avg % Viewed' },
  { key: 'likes', label: 'Likes' },
  { key: 'subscribersGained', label: 'Subs Gained' },
];

export function ChannelTableHead({ sortKey, descending, sortBy }: { sortKey: SortKey; descending: boolean; sortBy: (key: SortKey) => void }) {
  return (
    <thead>
      <tr>
        <th>Kind</th>
        {COLUMNS.map(({ key, label }) => {
          const direction = key === sortKey ? (descending ? 'descending' : 'ascending') : undefined;
          return (
            <th key={key} className={key === 'title' ? '' : 'num'} aria-sort={direction}>
              <button type="button" className="sort" onClick={() => sortBy(key)}>
                {label}<span className="sort-icon" aria-hidden="true">{direction ? (descending ? '▼' : '▲') : '↕'}</span>
              </button>
            </th>
          );
        })}
        <th className="num">Impressions</th>
        <th className="num">Thumbnail CTR</th>
        <th>Topic</th>
        <th>Angle</th>
      </tr>
    </thead>
  );
}

type ProfileChanges = Partial<VideoProfile>;

/** A main choice with a smaller second choice under it (the second reads "None" when empty). Both save straight away. */
function PairCell<T extends string>({ video, labels, main, second, save }: { video: ChannelVideo; labels: Record<T, string>; main: 'topic' | 'angle'; second: 'topic2' | 'angle2'; save: (changes: ProfileChanges) => void }) {
  const off = !video.piece;
  const tip = off ? 'Link this video in Video Projects first' : '';
  const choose = (field: 'topic' | 'topic2' | 'angle' | 'angle2') => (e: { target: { value: string } }) => save({ [field]: e.target.value } as ProfileChanges);
  return (
    <div className="pair">
      <select value={video[main]} disabled={off} title={tip} onChange={choose(main)}>
        {Object.entries<string>(labels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
      <select className="second" value={video[second]} disabled={off} title={tip || 'Optional second choice'} onChange={choose(second)}>
        {Object.entries<string>(labels).map(([id, label]) => <option key={id} value={id}>{id === 'unassigned' ? 'None' : label}</option>)}
      </select>
    </div>
  );
}

/** The note box for one video: saved when you leave it or press Enter. */
function NoteBox({ video, save }: { video: ChannelVideo; save: (note: string) => void }) {
  const [text, setText] = useState(video.note);
  useEffect(() => setText(video.note), [video.note]);
  return (
    <input type="text" className="channel-note" value={text} maxLength={2000} disabled={!video.piece} placeholder={video.piece ? 'Add a note' : 'Link it first'}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text.trim() !== video.note) save(text); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

function EndScreenActivity({ elements, note }: { elements?: EndScreenElement[]; note: string }) {
  return (
    <div>
      <strong>End Screen Activity</strong>
      {elements?.length ? (
        <ul className="channel-end-screens">
          {elements.map((element) => (
            <li key={element.id} title={`YouTube element ID: ${element.id}`}>
              {element.type} · {element.clicks.toLocaleString()} clicks / {element.impressions.toLocaleString()} shown
              {element.impressions > 0 && ` (${(100 * element.clicks / element.impressions).toFixed(1)}%)`}
            </li>
          ))}
        </ul>
      ) : <div className="muted">{note}</div>}
    </div>
  );
}

export function ChannelProjectCell({ video, saveNote, endScreens }: {
  video: ChannelVideo; saveNote: (note: string) => void; endScreens?: EndScreenData;
}) {
  const name = rowName(video);
  const source = video.fromLongform;
  const elements = endScreens?.status === 'ready' ? endScreens.videos[video.id] ?? [] : undefined;
  const endScreenNote = elements ? 'No activity reported for this period.'
    : endScreens?.note ?? 'Click Refresh YouTube Data to load end screen activity.';
  return (
    <td className="title">
      <div className="channel-project">
        <div>
          <a href={videoHash(video.id)} title={`Open Video Detail. On YouTube: ${video.title}`}>{name}</a>
          {!video.piece && <span className="muted"> (Not Linked)</span>}
          {video.privacy !== 'public' && <span className="muted"> ({video.privacy})</span>}
          {' '}<a className="yt-link" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer" title="Opens YouTube in a new tab. Watching there adds to this video's view count.">YouTube ↗</a>
        </div>
        {video.kind === 'short' && source !== 'standalone' && (
          <div className="channel-parent">
            {source ? <>From <a href={videoProjectsHash(source)}>{longformLabel(source)}</a></> : 'Source Unknown'}
          </div>
        )}
        <details className="channel-project-details">
          <summary aria-label={`Details for ${name}`} title="Video Details" />
          <div className="channel-project-fields">
            <label>Note <NoteBox video={video} save={saveNote} /></label>
            {(video.kind === 'longform' || !!elements?.length) && <EndScreenActivity elements={elements} note={endScreenNote} />}
          </div>
        </details>
      </div>
    </td>
  );
}

export function ChannelPage() {
  const [data, setData] = useState<ChannelVideoList | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [address, setAddress] = useState(() => location.hash);
  const [filters, setFilters] = useState(allVideoFacets);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [key, setKey] = useState<SortKey>('publishedAt');
  const [descending, setDescending] = useState(true);

  useEffect(() => { getJson<ChannelVideoList | null>('/api/channel/videos').then(setData, (e: Error) => setError(e.message)); }, []);
  useEffect(() => {
    getJson<Overview | null>('/api/channel/overview').then(setOverview, (e: Error) => setError(e.message));
  }, [refreshCount]);
  useEffect(() => {
    const sync = () => { if (location.hash.split('/')[0] === '#Channel') setAddress(location.hash); };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const refresh = async () => {
    setBusy(true); setError(null);
    try {
      const result = await postJson<Awaited<ReturnType<typeof refreshChannelWorkspace>>>('/api/channel/refresh');
      setData(result.catalog);
      setRefreshCount(n => n + 1);
      if (result.errors.length) setError(result.errors.join(' '));
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  /** Save one video's topic and note in its Drive folder, then show what the engine saved. */
  const saveProfile = async (video: ChannelVideo, changes: ProfileChanges) => {
    setError(null);
    try {
      const saved = await postJson<VideoProfile>('/api/video-profile', { piece: video.piece, topic: video.topic, topic2: video.topic2, angle: video.angle, angle2: video.angle2, note: video.note, ...changes });
      setData((d) => d && { ...d, videos: d.videos.map((v) => (v.id === video.id ? { ...v, ...saved } : v)) });
      setTouched((t) => new Set(t).add(video.id));
    } catch (e) { setError((e as Error).message); }
  };
  const sortBy = (next: SortKey) => {
    if (next === key) setDescending(!descending);
    else { setKey(next); setDescending(next !== 'title'); }
  };

  const rows = data ? channelRows(data.videos, { ...filters, text, keep: touched }, key, descending) : [];
  const count = (k: 'longform' | 'short') => data?.videos.filter((v) => v.kind === k).length ?? 0;
  const [, section, id] = address.split('/');
  const view = section === 'Recommendations' || section === 'Video' || section === 'Comments' || section === 'Research' ? section : 'Overview';
  const reach = (data && overview?.channelId === data.channel.id) ? overview : null;

  return (
    <div className="content channel-page">
      <div className="page-head">
        <h1>Channel</h1>
        <button type="button" className="small" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing YouTube Data…' : 'Refresh YouTube Data'}</button>
      </div>
      <nav className="channel-nav" aria-label="Channel Views">
        <a href="#Channel" aria-current={view === 'Overview' ? 'page' : undefined}>Overview</a>
        <a href="#Channel/Recommendations" aria-current={view === 'Recommendations' ? 'page' : undefined}>What to Make Next</a>
        <a href={id && view === 'Video' ? videoHash(id) : '#Channel/Video'} aria-current={view === 'Video' ? 'page' : undefined}>Video Detail</a>
        <a href="#Channel/Comments" aria-current={view === 'Comments' ? 'page' : undefined}>Comments</a>
        <a href="#Channel/Research" aria-current={view === 'Research' ? 'page' : undefined}>Research</a>
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      {view === 'Recommendations' && <AnalyticsAnalysis piece="" refresh={refreshCount} evidenceName={(id) => {
        const video = data?.videos.find(video => video.id === id);
        return video && rowName(video);
      }} />}
      {view === 'Video' && <ChannelVideoBrowser videos={data?.videos} id={id} />}
      {view === 'Comments' && <ChannelCommentsSync />}
      {view === 'Research' && <section><h2>Research Sources</h2><p className="muted">Planned sources include vidIQ, Ask Studio, Reddit, and news.</p></section>}
      {view === 'Overview' && <>
      {overview && (!data || reach) && <ChannelPerformance overview={overview} />}
      <ReachSetup />
      {data === null && <p className="muted">Use Refresh YouTube Data to load your videos.</p>}
      {data && (
        <>
          <p className="muted">
            {data.channel.title}: {count('longform')} longform, {count('short')} Shorts. Updated {new Date(data.updatedAt).toLocaleString()}.
            Lifetime numbers. “–” means no count is available.
            Kinds marked “?” are guessed from length. Topics and notes are saved in each video's Drive folder.
          </p>
          {data.trafficError && (
            <p className="muted" role="status">
              {data.trafficError} {data.trafficUpdatedAt && `Showing available Search and Browse Views saved on ${new Date(data.trafficUpdatedAt).toLocaleString()}.`}
            </p>
          )}
          {data.endScreens && (
            <p className="muted">
              End screens · {data.endScreens.status === 'ready'
                ? `${data.endScreens.startDate} through ${data.endScreens.endDate} (${data.endScreens.reportedDays} reporting days). Open a video's ▶ for details.`
                : data.endScreens.note}
              {data.endScreens.status === 'ready' && data.endScreens.note && ` Showing saved activity. ${data.endScreens.note}`}
            </p>
          )}
          <div className="idea-filters">
            <VideoFacetControls filters={filters} onChange={next => { setFilters(next); setTouched(new Set()); }} />
            <label className="idea-filter-text">Project, Title or Note
              <input type="search" value={text} placeholder="Search project names, YouTube titles and notes" onChange={(e) => { setText(e.target.value); setTouched(new Set()); }} />
            </label>
          </div>
          <table className="channel-table">
            <ChannelTableHead sortKey={key} descending={descending} sortBy={sortBy} />
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{channelKindLabel(v)}</td>
                  <ChannelProjectCell video={v} endScreens={data.endScreens} saveNote={(note) => void saveProfile(v, { note })} />
                  <td className="num">{v.publishedAt.slice(0, 10)}</td>
                  <td className="num">{v.numbers ? v.numbers.views.toLocaleString() : '–'}</td>
                  <td className="num">{v.traffic?.searchViews?.toLocaleString() ?? '–'}</td>
                  <td className="num">{v.traffic?.browseViews?.toLocaleString() ?? '–'}</td>
                  <td className="num">{v.numbers ? formatMinutes(v.numbers.minutesWatched) : '–'}</td>
                  <td className="num">{v.numbers ? `${v.numbers.averageViewPercentage.toFixed(1)}%` : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.likes.toLocaleString() : '–'}</td>
                  <td className="num">{v.numbers ? v.numbers.subscribersGained.toLocaleString() : '–'}</td>
                  <td className="num">{reach?.videoReach[v.id]?.impressions.toLocaleString() ?? '–'}</td>
                  <td className="num">{reach?.videoReach[v.id]?.ctrPercent == null ? '–' : `${reach.videoReach[v.id]!.ctrPercent!.toFixed(1)}%`}</td>
                  <td><PairCell video={v} labels={TOPIC_LABELS} main="topic" second="topic2" save={(changes) => void saveProfile(v, changes)} /></td>
                  <td><PairCell video={v} labels={ANGLE_LABELS} main="angle" second="angle2" save={(changes) => void saveProfile(v, changes)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted">No videos match.</p>}
        </>
      )}
      </>}
    </div>
  );
}

export function ChannelCommentsSync() {
  const [summary, setSummary] = useState<StoredCommentsSummary | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<CommentsSyncResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getJson<StoredCommentsSummary>('/api/channel/comments').then(setSummary, (e) => setError((e as Error).message));
  }, []);

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      const res = await postJson<CommentsSyncResult & { stored: StoredCommentsSummary }>('/api/channel/comments/sync', {});
      setLastResult(res);
      setSummary(res.stored);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section>
      <div className="page-head">
        <h2>Comments</h2>
        <button type="button" className="small" disabled={syncing} onClick={() => void sync()}>
          {syncing ? 'Syncing Comments…' : 'Sync Comments'}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {summary === null && !error && <p className="muted">Loading saved comments…</p>}
      {summary && summary.totalVideos === 0 && !syncing && (
        <p className="muted">No comments downloaded yet. Click Sync Comments to save your YouTube comments to Drive.</p>
      )}
      {summary && summary.totalVideos > 0 && (
        <p className="muted">
          Saved in Drive: {summary.totalThreads.toLocaleString()} comment {summary.totalThreads === 1 ? 'thread' : 'threads'} across {summary.totalVideos} {summary.totalVideos === 1 ? 'video' : 'videos'}
          {summary.disabledVideos > 0 ? ` (${summary.disabledVideos} with comments turned off)` : ''}.
          {summary.lastSyncedAt ? ` Last synced ${new Date(summary.lastSyncedAt).toLocaleString()}.` : ''}
        </p>
      )}
      {lastResult && lastResult.failed.length > 0 && (
        <p className="error" role="alert">
          {lastResult.failed.length} {lastResult.failed.length === 1 ? 'video' : 'videos'} failed to sync ({lastResult.failed[0].error}).
        </p>
      )}
    </section>
  );
}
