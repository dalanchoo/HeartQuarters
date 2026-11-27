import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fileUrl, getJson, getText, openInExplorer, postJson, thumbUrl, type BatchThumbJob, type BriefChoice, type BriefJob, type BriefPick, type BriefSource, type DraftConversation, type Drafts, type ExpressionIndex, type ThumbJob } from './api';
import { categoriesIn, photosIn } from './expressionPick';
import { CopyButton } from './PackagingDoc';
import { combineNotes, researchQuestion, type ResearchFacts } from './researchPrompt';
import { isCurrentChoice } from './draftPackaging';
import { readReferences } from './expressionPlanning';
import { CategoryPicker } from './CategoryPicker';
import type { DiscussionJob, DiscussionMessage } from '../../server/thumbnail-discussion';
import type { PhotoRanking, RankingJob } from '../../server/photo-ranking';
import { isAiExpression } from '../../server/expression-origin';
import type { AiId } from '../../server/ai';
import type { ExpressionShot } from '../../server/expression-shot-list';
import { expressionShotSuggestions } from '../../server/expression-shot-suggestions';
import { YouTubeOpenLink } from './YouTubeOpenLink';
import { AI_OPTIONS, AiSelect, aiName, useAiFor, useRemembered } from './AiChoice';

// The card's "Thumbnail & Title Drafts" section: the brainstorming in Packaging\Drafts before a version is made.
// At the top, Write Brief: the AIs John chose write Brief.md and review it, each with vidIQ if ticked, and the summary
// AI picks the top 3 title and thumbnail pairs (server/brief.ts). The top 3 show as cards to choose from; the full brief opens below them, then one
// box per AI conversation with every image it made, newest first, and what was asked. Once a pair and its photo are
// chosen, Make Thumbnail asks ChatGPT or Gemini for one (server/thumbnails.ts), and each draft has a box for changes.
export function DraftsSection({ piece, drafts, research, onChanged }: { piece: string; drafts: Drafts | null; research?: Research; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const thumbs = useThumbJobs(piece, open, onChanged);
  const images = drafts?.conversations.reduce((n, c) => n + c.images.length, 0) ?? 0;
  const conversations = drafts?.conversations.length ?? 0;
  // The brief, the top 3 and the photos take a lot of room; once there are drafts, they start folded away.
  const [briefOpen, setBriefOpen] = useState(conversations === 0);
  const briefSummary = [drafts?.brief ? 'brief written' : 'no brief yet', drafts?.choice ? `pair ${drafts.choice.index + 1} chosen` : null, drafts?.choice?.photo ? `photo ${drafts.choice.photo.split('/').pop()}` : null].filter(Boolean).join(', ');
  return (
    <details className="drafts" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Generate Packaging{' '}
        <span className="muted small-text">
          ·{' '}
          {drafts
            ? `${drafts.brief ? 'brief, ' : ''}${conversations} ${conversations === 1 ? 'conversation' : 'conversations'}, ${images} ${images === 1 ? 'image' : 'images'}`
            : 'none yet'}
        </span>
      </summary>
      {open && (
        <details className="brief-area" open={briefOpen} onToggle={(e) => setBriefOpen(e.currentTarget.open)}>
          <summary>
            Brief, Top 3, Photo and Make Thumbnail <span className="muted small-text">· {briefSummary}</span>
          </summary>
          <WriteBrief piece={piece} hasBrief={!!drafts?.brief} hasPicks={!!drafts?.picks} research={research} onChanged={onChanged} />
          {drafts && (drafts.brief || drafts.picks) && <ShotListSuggestions piece={piece} brief={drafts.brief} picks={drafts.picks ?? []} />}
          {drafts?.picks && <TopPicks piece={piece} picks={drafts.picks} choice={drafts.choice} thumbs={thumbs} onChanged={onChanged} />}
          {drafts?.choice?.photo && <MakeThumbnail piece={piece} choice={drafts.choice} thumbs={thumbs} onChanged={onChanged} />}
        </details>
      )}
      {drafts && (
        <>
          <div className="drafts-top">
            <button className="small" onClick={() => openInExplorer('projects', drafts.path)}>
              Open Drafts Folder
            </button>
            {drafts.brief && <TextToggle key={drafts.brief.path + drafts.brief.size} label="Full Brief" path={drafts.brief.path} />}
          </div>
          <div className="drafts-grid">
            {[...drafts.conversations].reverse().map((c) => (
              <Conversation key={c.path} piece={piece} conversation={c} chosenPhoto={drafts.choice?.photo ?? null} job={thumbs.jobs.find((j) => j.conversation === c.path)} thumbs={thumbs} />
            ))}
          </div>
        </>
      )}
    </details>
  );
}

function ShotListSuggestions({ piece, brief, picks }: { piece: string; brief: { path: string; modified?: number } | null; picks: BriefPick[] }) {
  const [text, setText] = useState('');
  const [shots, setShots] = useState<ExpressionShot[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Which AI compares new looks with the ones already on the list. Remembered in this browser.
  const [ai, setAi] = useAiFor('shot-list-add');
  useEffect(() => {
    let active = true;
    setText(''); setError(''); setMessage('');
    if (brief) void getText('projects', brief.path).then(value => { if (active) setText(value); }, (e: Error) => { if (active) setError(`Could Not Read the Brief: ${e.message}`); });
    const load = () => { void getJson<ExpressionShot[]>('/api/expressions/shot-list').then(value => { if (active) setShots(value); }, (e: Error) => { if (active) setError(e.message); }); };
    load(); window.addEventListener('hq-expression-shot-list-changed', load);
    return () => { active = false; window.removeEventListener('hq-expression-shot-list-changed', load); };
  }, [piece, brief?.path, brief?.modified]);
  const suggestions = expressionShotSuggestions(text, picks);
  const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  // A suggestion's words stay on the look it became or was merged into.
  const onList = (expression: string) => shots.some(shot => shot.sources.some(source => source.text !== undefined && normalized(source.text) === normalized(expression)));
  const missing = suggestions.filter(item => !onList(item.expression));
  const add = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await postJson<{ shots: ExpressionShot[]; added: number; merged: number; error?: string }>('/api/expressions/shot-list/add', { piece, shots: missing, ai });
      setShots(result.shots); setMessage(shotListMessage(result));
      if (result.error) setError(result.error);
      window.dispatchEvent(new Event('hq-expression-shot-list-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="yt-section shot-suggestions"><summary>Expression Suggestions for the Shot List <span className="muted">{suggestions.length} suggestions · {suggestions.length - missing.length} on the list</span></summary>
    <p className="muted small-text">Every expression the brief and its picks suggest goes onto the Shot List in Expressions by itself when the top 3 are picked. A look the list already has, worded differently, is merged into it.</p>
    <ul className="shot-suggestion-list">
      {suggestions.map(item => <li key={item.expression} className="shot-suggestion"><strong>{item.context}</strong> · {item.expression}<span className="muted"> · {onList(item.expression) ? 'On Shot List' : 'Not on Shot List'}</span></li>)}
    </ul>
    {!suggestions.length && !error && <p className="muted small-text">No labelled expression suggestions found.</p>}
    {missing.length > 0 && <div className="expression-inbox-actions">
      <button disabled={busy} onClick={() => void add()}>{busy ? 'Adding…' : `Add ${missing.length} to Shot List`}</button>
      <AiSelect value={ai} onChange={setAi} title="Which AI checks the new looks against the ones already on the Shot List" />
    </div>}
    {message && <p role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </details>;
}
/** "2 new looks added to the Shot List; 1 merged into a look it already had." */
export function shotListMessage({ added, merged }: { added: number; merged: number }): string {
  const looks = (n: number) => `${n} ${n === 1 ? 'look' : 'looks'}`;
  const parts = [added ? `${added === 1 ? '1 new look' : `${added} new looks`} added to the Shot List` : '', merged ? `${looks(merged)} merged into ${merged === 1 ? 'a look' : 'looks'} it already had` : ''].filter(Boolean);
  return parts.length ? `${parts.join('; ')}.` : 'Nothing new for the Shot List.';
}
interface ThumbJobs {
  jobs: ThumbJob[];
  /** Call after starting one: checks again, and keeps checking while any is working. */
  refresh: () => void;
}

/** The thumbnails being made for this piece. While any is working, checks every few seconds; when one finishes, the card reloads. */
function useThumbJobs(piece: string, open: boolean, onChanged?: () => void): ThumbJobs {
  const [jobs, setJobs] = useState<ThumbJob[]>([]);
  const before = useRef<Record<string, string>>({});
  const load = (isActive?: () => boolean) =>
    getJson<ThumbJob[]>(`/api/thumbs?piece=${encodeURIComponent(piece)}`).then((list) => {
      if (isActive && !isActive()) return;
      const finished = list.some((j) => before.current[j.conversation] === 'working' && j.state !== 'working');
      before.current = Object.fromEntries(list.map((j) => [j.conversation, j.state]));
      setJobs(list);
      if (finished) onChanged?.();
    }, () => undefined);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [open, piece]);
  const working = jobs.some((j) => j.state === 'working');
  useEffect(() => {
    if (!working || !open) return;
    let active = true;
    const timer = setInterval(() => void load(() => active), 4000);
    return () => { active = false; clearInterval(timer); };
  }, [working, open, piece]);
  return { jobs, refresh: () => void load() };
}

/** Make Thumbnail: sends the chosen pair and photo to ChatGPT or Gemini. Each go becomes a new draft below. */
function MakeThumbnail({ piece, choice, thumbs, onChanged }: { piece: string; choice: BriefChoice; thumbs: ThumbJobs; onChanged?: () => void }) {
  const [error, setError] = useState('');
  const make = (ai: 'codex' | 'gemini') => {
    setError('');
    postJson('/api/thumbs/make', { piece, ai }).then(
      () => {
        thumbs.refresh();
        onChanged?.(); // the new draft's box appears at once, marked as working
      },
      (e: Error) => setError(e.message),
    );
  };
  return (
    <div className="make-thumbnail">
      <h4>Make Thumbnail</h4>
      <p className="muted small-text">
        For {choice.pick.thumbnailText.toUpperCase()} with {choice.photo?.split('/').pop()}. Each go is a new draft below, and takes a minute or two.
        In tests, ChatGPT kept your likeness better than Gemini.
      </p>
      <div className="claude-buttons">
        <button className="small" onClick={() => make('codex')}>
          Make with ChatGPT
        </button>
        <button className="small" onClick={() => make('gemini')}>
          Make with Gemini
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The top 3 title and thumbnail pairs, as cards. Choose saves one (Choice.json); then its photos appear to pick from. */
function TopPicks({ piece, picks, choice, thumbs, onChanged }: { piece: string; picks: BriefPick[]; choice: BriefChoice | null; thumbs: ThumbJobs; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rankAi, setRankAi] = useAiFor('rank-photos');
  const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
  const [useCodex, setUseCodex] = useRemembered('hq-batch-codex', true, isBool);
  const [useGemini, setUseGemini] = useRemembered('hq-batch-gemini', true, isBool);
  const [batch, setBatch] = useState<BatchThumbJob | null>(null);
  const lastPairs = useRef('');
  const loadBatch = (isActive?: () => boolean) =>
    getJson<BatchThumbJob | null>(`/api/thumbs/batch?piece=${encodeURIComponent(piece)}`).then(
      (job) => {
        if (isActive && !isActive()) return;
        setBatch(job);
        const signature = job ? job.pairs.map((p) => `${p.state}:${p.conversations?.length ?? 0}`).join('|') : '';
        if (signature && signature !== lastPairs.current) {
          lastPairs.current = signature;
          thumbs.refresh();
          onChanged?.();
        }
      },
      () => undefined,
    );
  useEffect(() => {
    let active = true;
    lastPairs.current = '';
    void loadBatch(() => active);
    return () => { active = false; };
  }, [piece]);
  useEffect(() => {
    if (batch?.state !== 'working') return;
    let active = true;
    const timer = setInterval(() => void loadBatch(() => active), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [batch?.state, piece]);
  const selectedAis = [...(useCodex ? ['codex' as const] : []), ...(useGemini ? ['gemini' as const] : [])];
  const makeAll = () => {
    if (!selectedAis.length) return;
    setError('');
    postJson<BatchThumbJob>('/api/thumbs/make-all', { piece, ai: rankAi, ais: selectedAis }).then(
      (job) => {
        lastPairs.current = '';
        setBatch(job);
        thumbs.refresh();
      },
      (e: Error) => setError(e.message),
    );
  };
  // The saved choice counts only while it's still one of these picks (a new brief brings new picks).
  const chosen = isCurrentChoice(choice, picks) ? choice!.index : null;
  const choose = (index: number) => {
    setBusy(true);
    setError('');
    postJson('/api/brief/choose', { piece, index }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const batchWorking = batch?.state === 'working';
  const totalDrafts = picks.length * selectedAis.length;
  const aiLabel = useCodex && useGemini ? `All ${totalDrafts}` : useCodex ? `${totalDrafts} ChatGPT` : useGemini ? `${totalDrafts} Gemini` : '0';
  return (
    <div className="top-picks">
      <h4>Top 3 Title and Thumbnail Pairs</h4>
      <div className="batch-thumbs-bar">
        <label className="small-text batch-ai-check">
          <input type="checkbox" checked={useCodex} disabled={batchWorking} onChange={(e) => setUseCodex(e.target.checked)} /> ChatGPT
        </label>
        <label className="small-text batch-ai-check">
          <input type="checkbox" checked={useGemini} disabled={batchWorking} onChange={(e) => setUseGemini(e.target.checked)} /> Gemini
        </label>
        <button className="small" disabled={batchWorking || !selectedAis.length} onClick={makeAll}>
          {batchWorking ? `Making ${batch.ais.length === 2 ? `All ${picks.length * 2}` : `${picks.length} ${batch.ais[0] === 'codex' ? 'ChatGPT' : 'Gemini'}`} Drafts…` : `Make ${aiLabel} Drafts`}
        </button>
        <AiSelect value={rankAi} onChange={setRankAi} title="Which AI picks the best photo for each pair" />
        <span className="muted small-text">Picks the #1 photo for each pair and makes drafts with the checked AIs.</span>
      </div>
      {batch && (
        <ul className="batch-thumbs-status small-text">
          {batch.pairs.map((p) => (
            <li key={p.index}>
              <strong>Pair {p.index + 1}</strong> ({p.thumbnailText.toUpperCase()}):{' '}
              {p.state === 'pending' && <span className="muted">Waiting…</span>}
              {p.state === 'ranking' && <span>Picking best photo…</span>}
              {p.state === 'generating' && <span>Making ChatGPT &amp; Gemini drafts with {p.photo?.split('/').pop()}…</span>}
              {p.state === 'done' && (
                <span>
                  Done with {p.photo?.split('/').pop()}
                  {p.reason ? <span className="error"> · {p.reason}</span> : null}
                </span>
              )}
              {p.state === 'skipped' && <span className="muted">Skipped — {p.reason}</span>}
              {p.state === 'failed' && <span className="error">Failed — {p.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {batch?.state === 'failed' && batch.error && <p className="error small-text">{batch.error}</p>}
      <div className="top-picks-grid">
        {picks.map((p, i) => (
          <div key={i} className={`top-pick${chosen === i ? ' chosen' : ''}`}>
            <div className="top-pick-text">
              <ThumbnailWords text={p.thumbnailText} accent={p.accent} />
            </div>
            <p className="top-pick-title">{p.title}</p>
            <p className="small-text"><span className="muted">Expression:</span> {p.expression}</p>
            <p className="small-text"><span className="muted">Visual Concept:</span> {p.background}</p>
            <p className="small-text">{p.why}</p>
            {p.backedBy.length > 0 && <p className="muted small-text">Backed by {p.backedBy.join(', ')}</p>}
            <button className="small" disabled={busy || chosen === i} onClick={() => choose(i)}>
              {chosen === i ? 'Chosen' : 'Choose'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {chosen !== null && choice && <PhotoPicker key={chosen} piece={piece} choice={choice} onChanged={onChanged} />}
    </div>
  );
}

/**
 * The chosen pair's photos: every photo in the expressions-library categories it names, grouped by category. Clicking
 * one saves it as the photo for this pair.
 */
function PhotoPicker({ piece, choice, onChanged }: { piece: string; choice: BriefChoice; onChanged?: () => void }) {
  const [library, setLibrary] = useState<ExpressionIndex | null>(null);
  const [stars, setStars] = useState<string[]>(() => readReferences(localStorage));
  useEffect(() => {
    let active = true;
    const load = () => { void getJson<{ initialized: boolean; paths: string[] }>('/api/expression-references').then(result => { if (active) setStars(result.initialized ? result.paths : readReferences(localStorage)); }, () => {}); };
    load(); window.addEventListener('hq-starred-photos-changed', load);
    return () => { active = false; window.removeEventListener('hq-starred-photos-changed', load); };
  }, []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    getJson<ExpressionIndex>('/api/expressions').then(setLibrary, (e: Error) => setError(e.message));
  }, []);
  // Best Photos for This Pair: the chosen AI ranks the photos once per pair (each pair's ranking is saved in Drafts), started
  // here only when this pair has none. Going back to a pair shows its saved ranking; only Rank Again asks again.
  const [ranking, setRanking] = useState<{ ranking: PhotoRanking | null; job: RankingJob | null; madeFor?: string[] } | null>(null);
  const [rankAi, setRankAi] = useAiFor('rank-photos');
  const loadRanking = (isActive?: () => boolean) =>
    getJson<{ ranking: PhotoRanking | null; job: RankingJob | null; madeFor?: string[] }>(`/api/brief/ranking?piece=${encodeURIComponent(piece)}`).then(
      (r) => { if (!isActive || isActive()) setRanking(r); },
      (e: Error) => { if (!isActive || isActive()) setError(e.message); },
    );
  useEffect(() => {
    let active = true;
    setRanking(null);
    void loadRanking(() => active);
    return () => { active = false; };
  }, [piece, choice.pick.title]);
  const ranked = ranking?.ranking && ranking.ranking.title === choice.pick.title ? ranking.ranking : null;
  // A job belongs to the pair it was started for; one for another pair only means this pair has to wait.
  const forThisPair = !ranking?.job?.title || ranking.job.title === choice.pick.title;
  const anyRanking = ranking?.job?.state === 'working';
  const rankingNow = anyRanking && forThisPair;
  const rank = () => {
    setError('');
    postJson<RankingJob>('/api/brief/rank-photos', { piece, ai: rankAi }).then((job) => setRanking((r) => ({ ranking: r?.ranking ?? null, job, madeFor: r?.madeFor })), (e: Error) => setError(e.message));
  };
  // Generate a Look for This Pair: opens the pair's look on the Shot List, where pictures are made, moved to the
  // Inbox and confirmed. Confirmed ones come back here under Made for This Pairing.
  const [opening, setOpening] = useState(false);
  const generateLook = () => {
    setOpening(true);
    setError('');
    postJson<{ id: string }>('/api/brief/pair-shot', { piece }).then(({ id }) => { location.hash = `#Expressions/~shot/${id}`; }, (e: Error) => setError(e.message)).finally(() => setOpening(false));
  };
  // The library was loaded when this opened: a picture confirmed since then, or a ranking that names one, needs a fresh copy.
  const missing = !!library && [...(ranking?.madeFor ?? []), ...(ranked?.ranked.map(r => r.photo) ?? [])].some(path => !library.photos.some(p => p.path === path));
  useEffect(() => {
    if (missing) getJson<ExpressionIndex>('/api/expressions').then(setLibrary, (e: Error) => setError(e.message));
  }, [missing, ranking?.madeFor?.join('|'), ranked?.at]);
  const madeFor = library ?(ranking?.madeFor ?? []).map(path => library.photos.find(p => p.path === path)).filter((p): p is NonNullable<typeof p> => !!p) : [];
  const asked = useRef('');
  useEffect(() => {
    if (!ranking || ranked || anyRanking || (ranking.job?.state === 'failed' && forThisPair) || asked.current === choice.pick.title) return;
    asked.current = choice.pick.title;
    rank();
  }, [ranking, ranked, anyRanking, choice.pick.title]);
  useEffect(() => {
    if (!anyRanking) return;
    let active = true;
    const timer = setInterval(() => void loadRanking(() => active), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [anyRanking, piece]);
  // The pair's own categories first, then any John adds from the whole library.
  const [added, setAdded] = useState<string[]>([]);
  const categories = [...categoriesIn(choice.pick.expression), ...added.filter((c) => !categoriesIn(choice.pick.expression).includes(c))];
  const pick = (photo: string) => {
    setSaving(photo);
    setError('');
    postJson('/api/brief/photo', { piece, photo }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setSaving(null));
  };
  const tile = (p: { path: string; name: string; revision?: string }, place?: number, why?: string, label?: string) => {
    const picked = choice.photo === p.path;
    const root = p.path.startsWith('project:') ? 'projects' : 'expressions';
    const photoPath = root === 'projects' ? p.path.slice(8) : p.path;
    return (
      <div key={p.path} className={`photo-tile${picked ? ' picked' : ''}`}>
        <button className="photo-choice" disabled={saving !== null} title={why ? `${why}\n\nClick to use ${p.name}.` : `Use ${p.name}`} onClick={() => pick(p.path)}>
          <img src={thumbUrl(root, photoPath, 320, p.revision)} alt={p.name} loading="lazy" />
        </button>
        {(place !== undefined || label) && <div className="photo-rank" title={why}>{place !== undefined && `#${place}`}{place !== undefined && label && ' · '}{label}</div>}
        <div className="photo-path" title={p.path}>{(p.path.split('/').pop() ?? p.path).replace(/\.[^.]+$/, '')}</div>
        <div className="photo-tile-foot">
          {picked ? <span className="picked-label">✓ Picked</span> : saving === p.path ? <span className="muted">Saving…</span> : null}
          <a href={fileUrl(root, photoPath, p.revision)} target="_blank" rel="noreferrer">
            Full Size
          </a>
        </div>
      </div>
    );
  };
  return (
    <div className="photo-picker">
      <h4>Pick the Photo</h4>
      <p className="muted small-text">
        Click a photo to use it for this pair. Full Size opens the whole photo.
      </p>
      {choice.photo && (
        <div className="photo-group">
          <p className="small-text"><strong>Your photo</strong></p>
          <div className="photo-grid">{tile({ path: choice.photo, name: choice.photo.split('/').pop() ?? choice.photo })}</div>
        </div>
      )}
      <div className="photo-group">
        <p className="small-text">
          <strong>Best Photos for This Pair</strong>{' '}
          {ranked && <span className="muted">· {ranked.by ?? 'Claude'} looked at {ranked.looked} photos</span>}
          {ranked && !rankingNow && <AiSelect value={rankAi} onChange={setRankAi} title="Which AI ranks the photos" />}
          {ranked && !rankingNow && (
            <button className="small" onClick={rank} title="Searches the library again using current expression tags, folders, cues, ratings and pictures made for this pairing">
              Rank Again
            </button>
          )}
          <button className="small" disabled={opening} onClick={generateLook} title="Opens this pair's look on the Shot List, with the pair's photo cues. Generate pictures there, move the one you like to the Expression Inbox and confirm it; it then shows here as Made for This Pairing.">
            {opening ? 'Opening…' : 'Generate a Look for This Pair'}
          </button>
        </p>
        {!!choice.pick.photoAttributes?.length && <p className="muted small-text">Photo Cues: {choice.pick.photoAttributes.map(tag => tag.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}</p>}
        {rankingNow && <p className="brief-working small-text">{aiName(ranking?.job?.ai ?? 'claude')} is checking {ranking?.job?.looked} photos for a suitable camera photo…</p>}
        {anyRanking && !forThisPair && <p className="brief-working small-text">{aiName(ranking?.job?.ai ?? 'claude')} is still ranking photos for another pair. This pair's ranking starts when it's done.</p>}
        {ranked?.changed && !rankingNow && <p className="muted small-text">The photos for this pair have changed since this ranking (added, removed, re-rated or re-tagged). Use Rank Again to include the changes.</p>}
        {ranking?.job?.state === 'failed' && forThisPair && !rankingNow && (
          <p className="error small-text">
            {ranking.job.error}{' '}
            <button className="small" onClick={rank}>
              Try Again
            </button>
          </p>
        )}
        {ranked && !ranked.ranked.length && !rankingNow && <p className="muted small-text">There are no suitable photos in this ranking. Choose a photo below, or generate one for this pair.</p>}
        {ranked && !ranked.cameraFirst && !rankingNow && <p className="muted small-text">Use Rank Again to check this older ranking with camera photos first.</p>}
        {library && ((ranked?.ranked.length ?? 0) > 0 || madeFor.length > 0) && (
          <div className="photo-grid">
            {ranked?.ranked.map((r, i) => {
              const found = library.photos.find((p) => p.path === r.photo);
              if (!found) return null;
              const aiLabel = ranking?.madeFor?.includes(found.path) ? 'Made for This Pairing' : isAiExpression(found) ? ranked.cameraFirst ? 'AI Fallback' : 'AI-Generated' : undefined;
              return tile(found, i + 1, r.why, aiLabel);
            })}
            {/* A picture made for this pairing always shows, even when the ranking left it out (John, 2026-11-25). */}
            {madeFor.filter(p => !ranked?.ranked.some(r => r.photo === p.path)).map(p => tile(p, undefined, ranked ? `${ranked.by ?? 'Claude'} didn't put this picture in its ranking. If you confirmed it after the ranking, use Rank Again.` : 'Not ranked yet.', ranked ? 'Not Ranked · Made for This Pairing' : 'Made for This Pairing'))}
          </div>
        )}
      </div>
      {library && <details className="photo-group"><summary>Starred Photos ({library.photos.filter(p => stars.includes(p.path)).length})</summary>
        <div className="photo-grid">{library.photos.filter(p => stars.includes(p.path)).map((p) => tile(p))}</div>
        {!stars.length && <p className="muted">Star photos in Expressions to find them here.</p>}
      </details>}
      {!library && !error && <p className="muted small-text">Loading the expressions library…</p>}
      {library && categories.length === 0 && <p className="muted small-text">This pair names no library category. Add one below.</p>}
      {library &&
        categories.map((c) => {
          const photos = photosIn(library.photos, c);
          const mine = added.includes(c);
          // Suggested categories start folded; one John adds opens, since he added it to look at it.
          return (
            <details key={c} className="photo-group photo-category" open={mine || undefined}>
              <summary className="small-text">
                <strong>{c.split('/').join(' > ')}</strong> <span className="muted">· {mine ? 'added by you' : 'suggested'} · {photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
                {mine && (
                  <button className="small" onClick={(e) => { e.preventDefault(); setAdded(added.filter((a) => a !== c)); }}>
                    Remove
                  </button>
                )}
              </summary>
              {photos.length ? (
                <div className="photo-grid">{photos.map((p) => tile(p))}</div>
              ) : (
                <p className="muted small-text">No photos in this category yet. Add another category below.</p>
              )}
            </details>
          );
        })}
      {library && (
        <div className="small-text add-category"><CategoryPicker label="Show Photos From Another Category" value="" onChange={value => setAdded([...added.filter(a => a !== value), value])} options={library.categories.filter(c => c.path && !categories.includes(c.path)).map(c => ({ value: c.path, label: `${c.path.split('/').join(' > ')} (${c.totalCount ? `${c.totalCount} ${c.totalCount === 1 ? 'photo' : 'photos'}` : 'no photos yet'})`, disabled: c.totalCount === 0 }))} /></div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** The thumbnail's words in capitals, with the accent word in the accent colour. */
function ThumbnailWords({ text, accent }: { text: string; accent: string }) {
  const at = accent ? text.toUpperCase().indexOf(accent.toUpperCase()) : -1;
  if (at < 0) return <>{text.toUpperCase()}</>;
  return (
    <>
      {text.slice(0, at).toUpperCase()}
      <span className="accent-word">{text.slice(at, at + accent.length).toUpperCase()}</span>
      {text.slice(at + accent.length).toUpperCase()}
    </>
  );
}

const STATE_WORDS: Record<BriefJob['steps'][number]['state'], string> = {
  waiting: 'waiting',
  working: 'working…',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
};

/** Write Brief: the source it will use, the question for vidIQ and Ask Studio, boxes for John's notes and their answers, the button, and each AI's progress. */
/** What the research question for vidIQ and Ask Studio is filled in with, and the video's ID once it's on YouTube. */
export interface Research extends ResearchFacts { videoId?: string }

/** The three boxes, kept in this browser per video so pasted research isn't lost on a reload. */
function useBriefBoxes(piece: string) {
  const key = `hq-brief-notes:${piece}`;
  const [boxes, setBoxes] = useState<{ notes: string; vidiq: string; studio: string }>(() => {
    try {
      return { notes: '', vidiq: '', studio: '', ...JSON.parse(localStorage.getItem(key) ?? '{}') };
    } catch {
      return { notes: '', vidiq: '', studio: '' };
    }
  });
  const set = (part: 'notes' | 'vidiq' | 'studio', value: string) =>
    setBoxes((b) => {
      const next = { ...b, [part]: value };
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* kept only until the page is reloaded */
      }
      return next;
    });
  return [boxes, set] as const;
}

type BoxName = 'notes' | 'vidiq' | 'studio';
type Pasted = { data: string; preview: string };

/** Revokes blob: preview URLs when items are removed or the component unmounts. */
function useRevokePreviews(urls: string[]) {
  const prevRef = useRef<string[]>([]);
  useEffect(() => {
    const current = new Set(urls);
    for (const url of prevRef.current) {
      if (!current.has(url)) URL.revokeObjectURL(url);
    }
    prevRef.current = urls;
  }, [urls]);
  useEffect(() => () => {
    for (const url of prevRef.current) URL.revokeObjectURL(url);
  }, []);
}

/** One of the brief's boxes: text, plus screenshots pasted or dropped into it, shown small with a ✕ each. */
function BriefBox({ label, value, onText, images, onImages, placeholder }: { label: string; value: string; onText: (v: string) => void; images: Pasted[]; onImages: (i: Pasted[]) => void; placeholder: string }) {
  const [error, setError] = useState('');
  useRevokePreviews(images.map((img) => img.preview));
  const add = (files: File[]) => {
    if (!files.length) return;
    setError('');
    readImages(files).then((more) => {
      const ok = more.flatMap((m) => (m.kind === 'pasted' ? [{ data: m.data, preview: m.preview }] : []));
      if (!ok.length) setError('Only PNG, JPEG or WebP images can be pasted here.');
      onImages([...images, ...ok]);
    }, (e: Error) => setError(e.message));
  };
  return (
    <div className="brief-box" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add([...e.dataTransfer.files]); }}>
      <span>{label}</span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onText(e.target.value)}
        onPaste={(e) => {
          const files = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
          if (!files.length) return; // ordinary text
          e.preventDefault();
          add(files);
        }}
        placeholder={`${placeholder}. You can paste or drop screenshots here too.`}
      />
      {images.length > 0 && (
        <div className="ref-list">
          {images.map((img, i) => (
            <div key={i} className="ref-item">
              <a href={img.preview} target="_blank" rel="noreferrer" title="Open full size">
                <img src={img.preview} alt={`${label}, image ${i + 1}`} />
              </a>
              <button className="small" title="Remove this image" onClick={() => onImages(images.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error small-text">{error}</p>}
    </div>
  );
}

/** Who does the brief, as the page keeps it: three slots (the 2nd and 3rd can be empty) and the summary AI. */
interface BriefSlots { slots: { ai: AiId | ''; vidiq: boolean }[]; picker: AiId }

const DEFAULT_BRIEF_SLOTS: BriefSlots = {
  slots: [{ ai: 'claude', vidiq: true }, { ai: 'codex', vidiq: false }, { ai: 'gemini', vidiq: false }],
  picker: 'claude',
};

const isBriefSlots = (v: unknown): v is BriefSlots => {
  const s = v as BriefSlots;
  const ai = (a: unknown) => a === 'claude' || a === 'codex' || a === 'gemini';
  return !!s && Array.isArray(s.slots) && s.slots.length === 3 && ai(s.slots[0]?.ai) && s.slots.every((x) => x && (x.ai === '' || ai(x.ai)) && typeof x.vidiq === 'boolean') && ai(s.picker);
};

/** The plan the engine wants: the chosen AIs in order, without the empty slots. */
const briefPlan = (b: BriefSlots) => ({ steps: b.slots.filter((s) => s.ai).map((s) => ({ ai: s.ai as AiId, vidiq: s.vidiq })), picker: b.picker });

const SLOT_LABELS = ['1st (Writes)', '2nd (Reviews)', '3rd (Reviews)'];

/** Choose the AI for each step of the brief, whether it may use vidIQ, and who picks the top 3. */
function BriefPlanPicker({ value, onChange }: { value: BriefSlots; onChange: (b: BriefSlots) => void }) {
  const setSlot = (i: number, part: Partial<BriefSlots['slots'][number]>) =>
    onChange({ ...value, slots: value.slots.map((s, j) => (j === i ? { ...s, ...part, ...(part.ai === '' ? { vidiq: false } : {}) } : s)) });
  return (
    <div className="brief-plan">
      {value.slots.map((s, i) => (
        <div key={i} className="brief-plan-step">
          <span className="muted small-text">{SLOT_LABELS[i]}</span>
          <select className="ai-select" value={s.ai} onChange={(e) => setSlot(i, { ai: e.target.value as AiId | '' })}>
            {i > 0 && <option value="">None</option>}
            {AI_OPTIONS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="small-text" title="Let this AI research with vidIQ (up to 4 calls, which cost vidIQ credits)">
            <input type="checkbox" checked={s.vidiq} disabled={!s.ai} onChange={(e) => setSlot(i, { vidiq: e.target.checked })} /> vidIQ
          </label>
        </div>
      ))}
      <div className="brief-plan-step">
        <span className="muted small-text">Picks Top 3</span>
        <AiSelect value={value.picker} onChange={(picker) => onChange({ ...value, picker })} title="Which AI reads the brief and its reviews and picks the top 3 pairs" />
      </div>
    </div>
  );
}

function WriteBrief({ piece, hasBrief, hasPicks, research, onChanged }: { piece: string; hasBrief: boolean; hasPicks: boolean; research?: Research; onChanged?: () => void }) {
  const [plan, setPlan] = useRemembered<BriefSlots>('hq-brief-plan', DEFAULT_BRIEF_SLOTS, isBriefSlots);
  // Screenshots pasted into the boxes. Unlike the text, they aren't kept over a reload (too big for the browser's storage).
  const [shots, setShots] = useState<Record<BoxName, Pasted[]>>({ notes: [], vidiq: [], studio: [] });
  const images = { notes: shots.notes.map((s) => s.data), vidiq: shots.vidiq.map((s) => s.data), studio: shots.studio.map((s) => s.data) };
  const [source, setSource] = useState<BriefSource | null | undefined>(undefined);
  const [job, setJob] = useState<BriefJob | null>(null);
  const [boxes, setBox] = useBriefBoxes(piece);
  // The AIs get the three boxes as one text, each part under its own heading.
  const notes = combineNotes(boxes.notes, boxes.vidiq, boxes.studio);
  // Not on YouTube yet: vidIQ and Ask Studio can't watch it, so the question carries its transcript (or script).
  const [sourceText, setSourceText] = useState<{ kind: 'transcript' | 'script'; text: string } | null>(null);
  const onYoutube = !!research?.url;
  useEffect(() => {
    if (onYoutube) return setSourceText(null);
    let active = true;
    getJson<{ kind: 'transcript' | 'script'; text: string } | null>(`/api/brief/source-text?piece=${encodeURIComponent(piece)}`).then(
      (r) => active && setSourceText(r),
      () => active && setSourceText(null),
    );
    return () => {
      active = false;
    };
  }, [piece, onYoutube, source?.path]);
  const question = research ? researchQuestion({ ...research, source: sourceText ?? undefined }) : '';
  const [error, setError] = useState('');
  const wasRunning = useRef(false);

  const load = (isActive?: () => boolean) =>
    getJson<{ source: BriefSource | null; job: BriefJob | null }>(`/api/brief?piece=${encodeURIComponent(piece)}`).then(
      (r) => {
        if (isActive && !isActive()) return;
        setSource(r.source);
        setJob(r.job);
      },
      (e: Error) => { if (!isActive || isActive()) setError(e.message); },
    );
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [piece]);

  // While the AIs work, check every few seconds. When they finish, the card reloads to show the new brief.
  const running = job?.status === 'running';
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      onChanged?.();
    }
    if (!running) return;
    let active = true;
    const timer = setInterval(() => void load(() => active), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [running, piece]);

  const start = () => {
    if (hasBrief && !window.confirm('Write a new brief? The current Brief.md is kept, renamed with its date and time.')) return;
    setError('');
    postJson<BriefJob>('/api/brief/start', { piece, notes, images, plan: briefPlan(plan) }).then(setJob, (e: Error) => setError(e.message));
  };
  // For a brief written before there were picks, or to pick again: only the last step, about a minute.
  const pick = () => {
    setError('');
    postJson<BriefJob>('/api/brief/picks', { piece, notes, images, picker: plan.picker }).then(setJob, (e: Error) => setError(e.message));
  };
  const steps = briefPlan(plan).steps;
  const usesVidiq = steps.some((s) => s.vidiq);

  if (source === undefined) return error ? <p className="error">{error}</p> : null;
  return (
    <div className="write-brief">
      <p className="muted small-text">
        {source
          ? `Made from the ${source.kind}: ${source.path.split('/').pop()}. ${aiName(steps[0].ai)} writes the brief${steps.length > 1 ? `, ${steps.slice(1).map((s) => aiName(s.ai)).join(' and ')} ${steps.length > 2 ? 'each add' : 'adds'} a review` : ''}, and ${aiName(plan.picker)} picks the top 3.${usesVidiq ? ' Each AI with vidIQ ticked uses a few vidIQ credits.' : ''} It takes several minutes.`
          : 'There is no transcript in Subtitles and no script (a file with "script" in its name) to make a brief from yet.'}
      </p>
      {source && !running && (
        <>
          {question && (
            <details className="research-question">
              <summary>Question for vidIQ and Ask Studio</summary>
              <p className="muted small-text">Paste it into vidIQ and into Ask Studio, then paste each answer into its box below.</p>
              <pre className="lvy-value">{question}</pre>
              <div className="draft-use">
                <CopyButton text={question} label="Copy Question" />
                {research?.videoId && (
                  <YouTubeOpenLink href={`https://studio.youtube.com/video/${encodeURIComponent(research.videoId)}/edit`} studio />
                )}
              </div>
            </details>
          )}
          <BriefBox label="Notes for the AIs" value={boxes.notes} onText={(v) => setBox('notes', v)} images={shots.notes} onImages={(i) => setShots({ ...shots, notes: i })} placeholder="Optional: for example what you don't like about the current thumbnail, or which version is on YouTube" />
          <BriefBox label="vidIQ's answer" value={boxes.vidiq} onText={(v) => setBox('vidiq', v)} images={shots.vidiq} onImages={(i) => setShots({ ...shots, vidiq: i })} placeholder="Paste what vidIQ suggested, such as its title and tag scores" />
          <BriefBox label="Ask Studio's answer" value={boxes.studio} onText={(v) => setBox('studio', v)} images={shots.studio} onImages={(i) => setShots({ ...shots, studio: i })} placeholder="Paste what Ask Studio suggested" />
          <BriefPlanPicker value={plan} onChange={setPlan} />
          <div className="claude-buttons">
            <button className="small" onClick={start}>
              {hasBrief ? 'Write New Brief' : 'Write Brief'}
            </button>
            {hasBrief && (
              <button className="small" onClick={pick} title={`${aiName(plan.picker)} reads the brief and its reviews and picks the top 3 pairs again (about a minute)`}>
                {hasPicks ? 'Pick Top 3 Again' : 'Pick Top 3'}
              </button>
            )}
          </div>
        </>
      )}
      {job && (
        <ul className="brief-steps">
          {job.steps.map((s, i) => (
            <li key={i} className={`brief-step brief-${s.state}`}>
              {s.name} {s.role === 'writes' ? 'writes the brief' : s.role === 'reviews' ? 'reviews it' : 'picks the top 3'}{s.vidiq ? ' (with vidIQ)' : ''}: {STATE_WORDS[s.state]}
              {s.error && <span className="error"> {s.error}</span>}
            </li>
          ))}
        </ul>
      )}
      {job?.kept && <p className="muted small-text">The earlier brief was kept as {job.kept}.</p>}
      {job?.status === 'running' && job.steps.at(-1)?.state === 'done' && <p className="muted small-text">Adding the expressions to the Shot List…</p>}
      {job?.shotList && <p className="muted small-text">{shotListMessage(job.shotList)}</p>}
      {job?.shotList?.error && <p className="error small-text">{job.shotList.error}</p>}
      {job?.error && <p className="error">{job.error}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/** A reference image for a change request: pasted or dropped (sent as image data), or one of this video's drafts. */
type Reference = { kind: 'pasted'; data: string; preview: string } | { kind: 'draft'; path: string; label: string };

/** Reads pasted or dropped image files as references. */
function readImages(files: File[]): Promise<Reference[]> {
  return Promise.all(
    files
      .filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))
      .map(
        (f) =>
          new Promise<Reference>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Could not read the image.'));
            reader.onload = () => {
              const url = String(reader.result);
              resolve({ kind: 'pasted', data: url.split(',')[1] ?? '', preview: URL.createObjectURL(f) });
            };
            reader.readAsDataURL(f);
          }),
      ),
  );
}

const FEEDBACK_PROMPT = 'Please review this thumbnail and its title/text. Does my expression fit the story, is it readable at phone size, and is everything literally true to the transcript?';

function Conversation({ piece, conversation, chosenPhoto, job, thumbs }: { piece: string; conversation: DraftConversation; chosenPhoto: string | null; job?: ThumbJob; thumbs: ThumbJobs }) {
  // A photo of John chosen since this conversation started can go with a new round, as its new identity reference.
  const newPhoto = chosenPhoto && chosenPhoto !== conversation.photo ? chosenPhoto : null;
  const [sendPhoto, setSendPhoto] = useState(false);
  const rounds = [...conversation.images].reverse(); // newest first
  const [shown, setShown] = useState<string | undefined>(undefined);
  const current = rounds.find((r) => r.path === shown) ?? rounds[0];
  const pick = (current && conversation.roundPicks?.[current.name]) ?? conversation.pick;
  const [using, setUsing] = useState(false);
  const [used, setUsed] = useState('');
  const [error, setError] = useState('');
  const [copiedPath, setCopiedPath] = useState('');
  const working = job?.state === 'working';
  const withPhoto = !!newPhoto && sendPhoto;
  const generateRound = (text: string, pasted: string[], onDone: () => void) => {
    setError('');
    postJson('/api/thumbs/change', { piece, conversation: conversation.path, text, pasted, drafts: [], photo: withPhoto }).then(
      () => {
        setSendPhoto(false);
        setShown(undefined); // show the new round when it arrives
        onDone();
        thumbs.refresh();
      },
      (e: Error) => setError(e.message),
    );
  };
  return (
    <div className="thumb-draft">
      <h4>{conversation.name}</h4>
      {current ? (
        <a href={fileUrl('projects', current.path)} target="_blank" rel="noreferrer" title="Open full size">
          <img src={thumbUrl('projects', current.path, 640)} alt={`${conversation.name}, ${current.name}`} />
        </a>
      ) : (
        <div className="draft-no-thumb">
          <span className="video-preview-placeholder">
            <span aria-hidden="true">▧</span>
            <span>No thumbnail</span>
          </span>
        </div>
      )}
      {rounds.length > 1 && (
        <div className="draft-rounds">
          {rounds.map((r) => (
            <button key={r.path} className={`small version ${r.path === current?.path ? 'active' : ''}`} onClick={() => setShown(r.path)}>
              {r.name.replace(/\.[^.]+$/, '')}
            </button>
          ))}
        </div>
      )}
      {pick && (
        <div className="draft-pair">
          <div className="draft-pair-title">{pick.title}</div>
          <div className="muted small-text">Thumbnail Text: {pick.thumbnailText.toUpperCase()}</div>
          {pick.thumbnailIdea && (
            <details className="yt-section">
              <summary>Thumbnail Idea</summary>
              <p>{pick.thumbnailIdea}</p>
            </details>
          )}
        </div>
      )}
      {working && <p className="brief-working small-text">{conversation.name.replace(/ \d+$/, '')} is working on it…</p>}
      {job?.state === 'failed' && <p className="error small-text">{job.error}</p>}
      <ThumbnailChat
        key={conversation.path}
        piece={piece}
        conversationPath={conversation.path}
        image={current?.path ?? ''}
        jobState={job?.state}
        canGenerate={rounds.length > 0 && !working}
        newPhoto={newPhoto}
        conversationPhoto={conversation.photo}
        sendPhoto={sendPhoto}
        onSendPhotoChange={setSendPhoto}
        onGenerate={generateRound}
      />
      <div className="draft-use">
        <button
          className="small"
          disabled={!current || working || using || copiedPath === current.path}
          onClick={() => {
            if (!current) return;
            setUsing(true);
            setError('');
            postJson<{ path: string }>('/api/expressions/inbox/copy-thumbnail', { piece, image: current.path })
              .then(
                (result) => {
                  setCopiedPath(current.path);
                  setUsed(`Copied to Expression Inbox: ${result.path}`);
                  window.dispatchEvent(new Event('hq-expression-inbox-changed'));
                },
                (e: Error) => setError(e.message),
              )
              .finally(() => setUsing(false));
          }}
        >
          Copy to Expression Inbox
        </button>
      </div>
      {used && <p className="small-text picked-label">{used}</p>}
      {error && <p className="error small-text">{error}</p>}
      {conversation.requests && <TextToggle label="Requests" path={conversation.requests.path} />}
    </div>
  );
}

/**
 * One persistent chat area per draft: switch between Claude, ChatGPT and Gemini in the same conversation,
 * paste/drop images, insert a feedback prompt to edit, or generate the next round without leaving the chat.
 */
function ThumbnailChat({
  piece,
  conversationPath,
  image,
  jobState,
  canGenerate,
  newPhoto,
  conversationPhoto,
  sendPhoto,
  onSendPhotoChange,
  onGenerate,
}: {
  piece: string;
  conversationPath: string;
  image: string;
  jobState?: ThumbJob['state'];
  canGenerate: boolean;
  newPhoto: string | null;
  conversationPhoto: string | null;
  sendPhoto: boolean;
  onSendPhotoChange: (checked: boolean) => void;
  onGenerate: (text: string, pasted: string[], onDone: () => void) => void;
}) {
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [job, setJob] = useState<DiscussionJob | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [pics, setPics] = useState<Reference[]>([]);
  useRevokePreviews(pics.flatMap((p) => (p.kind === 'pasted' ? [p.preview] : [])));
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const replying = job?.state === 'working';
  const addPics = (files: File[]) => {
    if (!files.length) return;
    readImages(files).then((more) => {
      if (!more.length) setError('Only PNG, JPEG or WebP images can be added.');
      setPics((p) => [...p, ...more].slice(0, 4));
    }, (e: Error) => setError(e.message));
  };
  const picUrl = (name: string) => `/api/thumbs/discussion/image?piece=${encodeURIComponent(piece)}&image=${encodeURIComponent(image)}&conversation=${encodeURIComponent(conversationPath)}&name=${encodeURIComponent(name)}`;
  const url = `/api/thumbs/discussion?piece=${encodeURIComponent(piece)}&image=${encodeURIComponent(image)}&conversation=${encodeURIComponent(conversationPath)}`;
  const load = (isActive: () => boolean = () => true) => getJson<{ messages: DiscussionMessage[]; job: DiscussionJob | null }>(url).then(
    (data) => { if (isActive()) { setMessages(data.messages); setJob(data.job); } },
    (e: Error) => { if (isActive()) setError(e.message); },
  );
  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => { active = false; };
  }, [piece, conversationPath, image, jobState]);
  useEffect(() => {
    if (!replying) return;
    let active = true;
    const timer = setInterval(() => void load(() => active), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [replying, piece, conversationPath, image]);
  const send = (ai: AiId) => {
    const text = draft.trim();
    const pasted = pics.flatMap((p) => (p.kind === 'pasted' ? [p.data] : []));
    if (!text && !pasted.length) return;
    setError('');
    postJson<DiscussionJob>('/api/thumbs/discussion', { piece, image, conversation: conversationPath, ai, message: text, pasted }).then(
      (started) => { setDraft(''); setPics([]); setJob(started); void load(); },
      (e: Error) => setError(e.message),
    );
  };
  const startOver = () => {
    if (!window.confirm('Start over? This forgets the discussion about this draft.')) return;
    postJson('/api/thumbs/discussion/clear', { piece, image, conversation: conversationPath }).then(() => { setMessages([]); setJob(null); }, (e: Error) => setError(e.message));
  };
  const latestChangeRequest = [...messages].reverse().find((m) => m.changeRequest && (!m.image || m.image === image))?.changeRequest ?? '';
  const withPhoto = !!newPhoto && sendPhoto;
  const canSubmitRound = canGenerate && !!(draft.trim() || latestChangeRequest || withPhoto);
  const triggerGenerate = () => {
    const pasted = pics.flatMap((p) => (p.kind === 'pasted' ? [p.data] : []));
    const text = draft.trim() || latestChangeRequest || (withPhoto ? 'Use the newly chosen photo of John.' : '');
    if (!text) return;
    onGenerate(text, pasted, () => {
      setDraft('');
      setPics([]);
    });
  };
  const insertFeedback = () => {
    setDraft((prev) => (prev.trim() ? `${prev.trim()}\n\n${FEEDBACK_PROMPT}` : FEEDBACK_PROMPT));
    boxRef.current?.focus();
  };
  const speaker = (from: DiscussionMessage['from']) => (from === 'john' ? 'You' : aiName(from));
  return (
    <div className="thumbnail-chat">
      {messages.length > 0 && (
        <div className="thumbnail-chat-log">
          {messages.map((m) => (
            <div key={m.id} className={`discussion-message ${m.from === 'john' ? 'from-john' : 'from-ai'}`}>
              <div className="small-text">
                <strong>{speaker(m.from)}</strong> <span className="muted">· {new Date(m.at).toLocaleString()}</span>
              </div>
              {m.from === 'john' ? <p className="discussion-text">{m.text}</p> : <div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown></div>}
              {!!m.images?.length && (
                <div className="ref-list">
                  {m.images.map((name) => (
                    <a key={name} className="ref-item" href={picUrl(name)} target="_blank" rel="noreferrer" title="Open full size">
                      <img src={picUrl(name)} alt="Pasted image" />
                    </a>
                  ))}
                </div>
              )}
              {m.changeRequest && (
                <div className="claude-buttons">
                  <button className="small" onClick={() => { setDraft(m.changeRequest!); boxRef.current?.focus(); }}>
                    Edit Change Request
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {replying && <p className="brief-working small-text">{aiName(job?.ai ?? 'claude')} is replying…</p>}
      {job?.state === 'failed' && <p className="error small-text">{aiName(job.ai)}: {job.error}</p>}
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addPics([...e.dataTransfer.files]); }}>
        <textarea
          ref={boxRef}
          rows={2}
          value={draft}
          maxLength={4000}
          disabled={replying}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
            if (!files.length) return; // ordinary text
            e.preventDefault();
            addPics(files);
          }}
          placeholder="Chat about this thumbnail, or describe changes for a new round. Paste or drop any image here."
        />
        {pics.length > 0 && (
          <div className="ref-list">
            {pics.map((p, i) => (
              <div key={i} className="ref-item">
                <img src={p.kind === 'pasted' ? p.preview : thumbUrl('projects', p.path, 240)} alt="Image to send" />
                <button className="small" title="Remove this image" onClick={() => setPics(pics.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {newPhoto && (
        <label className="new-photo-choice small-text">
          <input type="checkbox" checked={sendPhoto} onChange={(e) => onSendPhotoChange(e.target.checked)} />
          <span>
            Use the Photo Chosen Now: <strong>{newPhoto.split('/').pop()}</strong>
            {conversationPhoto && <span className="muted"> (this conversation uses {conversationPhoto.split('/').pop()})</span>}
          </span>
        </label>
      )}
      <div className="claude-buttons">
        {AI_OPTIONS.map((opt) => (
          <button key={opt.id} className="small" disabled={replying || (!draft.trim() && !pics.length)} onClick={() => send(opt.id)}>
            Ask {opt.name}
          </button>
        ))}
        <button className="small" type="button" disabled={replying} onClick={insertFeedback} title="Inserts a feedback prompt you can edit before sending">
          Ask for Feedback
        </button>
        <button className="small" type="button" disabled={!canSubmitRound} onClick={triggerGenerate} title={draft.trim() ? 'Generates a new round from what you typed' : latestChangeRequest ? 'Generates a new round from the latest Change Request above' : 'Type changes or discuss first'}>
          Generate New Round
        </button>
        {messages.length > 0 && (
          <button className="small" disabled={replying} onClick={startOver} title="Forgets this draft's discussion">
            Start Over
          </button>
        )}
      </div>
      {error && <p className="error small-text" role="alert">{error}</p>}
    </div>
  );
}

/** A button that shows or hides a text file from the drafts, as formatted text (headings, bold, lists). */
function TextToggle({ label, path }: { label: string; path: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open && text === null) getText('projects', path).then((t) => setText(t.replace(/^﻿/, '')), (e: Error) => setError(e.message));
  }, [open, path, text]);
  return (
    <div className="draft-text">
      <button className="small" onClick={() => setOpen(!open)}>
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && (error ? <p className="error">{error}</p> : text === null ? <p className="muted small-text">Loading…</p> : <div className="markdown draft-md"><Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown></div>)}
    </div>
  );
}
