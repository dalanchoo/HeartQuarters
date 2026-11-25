import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fileUrl, getJson, getText, openInExplorer, postJson, thumbUrl, type BriefChoice, type BriefJob, type BriefPick, type BriefSource, type DraftConversation, type Drafts, type ExpressionIndex, type ThumbJob } from './api';
import { categoriesIn, photosIn } from './expressionPick';
import { CopyButton } from './PackagingDoc';
import { combineNotes, researchQuestion, type ResearchFacts } from './researchPrompt';
import { isCurrentChoice } from './draftPackaging';
import { readReferences } from './expressionPlanning';
import { CategoryPicker } from './CategoryPicker';
import type { ThumbnailReview, ThumbnailReviewJob } from '../../server/thumbnail-feedback';
import type { PhotoRanking, RankingJob } from '../../server/photo-ranking';
import { isAiExpression } from '../../server/expression-origin';
import type { AiId } from '../../server/ai';
import type { ExpressionShot } from '../../server/expression-shot-list';
import { expressionShotSuggestions } from './expressionShotSuggestions';
import { YouTubeOpenLink } from './YouTubeOpenLink';
import { AI_OPTIONS, AiSelect, aiName, useRemembered } from './AiChoice';

// The card's "Thumbnail & Title Drafts" section: the brainstorming in Packaging\Drafts before a version is made.
// At the top, Write Brief: the AIs John chose write Brief.md and review it, each with vidIQ if ticked, and the summary
// AI picks the top 3 title and thumbnail pairs (server/brief.ts). The top 3 show as cards to choose from; the full brief opens below them, then one
// box per AI conversation with every image it made, newest first, and what was asked. Once a pair and its photo are
// chosen, Make Thumbnail asks ChatGPT or Gemini for one (server/thumbnails.ts), and each draft has a box for changes.
/** The packaging version selected on the card: where Use Thumbnail and Use Title put a draft. Locked when it's an old one. */
export interface UseTarget { name: string; path: string; locked: boolean }

export function DraftsSection({ piece, drafts, target, research, onChanged }: { piece: string; drafts: Drafts | null; target?: UseTarget; research?: Research; onChanged?: () => void }) {
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
          {drafts?.picks && <TopPicks piece={piece} picks={drafts.picks} choice={drafts.choice} onChanged={onChanged} />}
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
              <Conversation key={c.path} piece={piece} target={target} conversation={c} chosenPhoto={drafts.choice?.photo ?? null} allDrafts={drafts.conversations} job={thumbs.jobs.find((j) => j.conversation === c.path)} thumbs={thumbs} onChanged={onChanged} />
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
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setText(''); setSelected([]); setError('');
    if (brief) void getText('projects', brief.path).then(value => { if (active) setText(value); }, (e: Error) => { if (active) setError(`Could Not Read the Brief: ${e.message}`); });
    void getJson<ExpressionShot[]>('/api/expressions/shot-list').then(value => { if (active) setShots(value); }, (e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [piece, brief?.path, brief?.modified]);
  const suggestions = expressionShotSuggestions(text, picks);
  const validSelected = selected.filter(value => suggestions.some(item => item.expression === value));
  const normalized = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const add = async () => {
    setBusy(true); setError(''); setMessage('');
    try {
      const chosen = suggestions.filter(s => validSelected.includes(s.expression));
      const result = await postJson<ExpressionShot[]>('/api/expressions/shot-list/add', { piece, shots: chosen });
      setShots(result); setSelected([]); setMessage(`${chosen.length} ${chosen.length === 1 ? 'suggestion added' : 'suggestions added'} to the Expression Shot List.`);
      window.dispatchEvent(new Event('hq-expression-shot-list-changed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return <details className="yt-section shot-suggestions"><summary>Expression Suggestions for the Shot List ({suggestions.length})</summary>
    <p className="muted small-text">Select the expressions you still need to photograph, then add them to the shot list in Expressions. The suggestions include the brief and the final picks.</p>
    {suggestions.map(item => <label key={item.expression} className="shot-suggestion"><input type="checkbox" checked={selected.includes(item.expression)} disabled={busy} onChange={e => setSelected(values => e.target.checked ? [...values, item.expression] : values.filter(value => value !== item.expression))} /><span><strong>{item.context}</strong> · {item.expression}{shots.some(shot => shot.sources.some(source => source.text !== undefined && normalized(source.text) === normalized(item.expression))) && <span className="muted"> · Already on Shot List</span>}</span></label>)}
    {!suggestions.length && !error && <p className="muted small-text">No labelled expression suggestions found.</p>}
    <button disabled={busy || !validSelected.length} onClick={() => void add()}>Add Selected to Shot List</button>
    {message && <p role="status">{message}</p>}{error && <p className="error" role="alert">{error}</p>}
  </details>;
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
function TopPicks({ piece, picks, choice, onChanged }: { piece: string; picks: BriefPick[]; choice: BriefChoice | null; onChanged?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The saved choice counts only while it's still one of these picks (a new brief brings new picks).
  const chosen = isCurrentChoice(choice, picks) ? choice!.index : null;
  const choose = (index: number) => {
    setBusy(true);
    setError('');
    postJson('/api/brief/choose', { piece, index }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  return (
    <div className="top-picks">
      <h4>Top 3 Title and Thumbnail Pairs</h4>
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
  // Best Photos for This Pair: Claude ranks the photos once per pair (saved in Drafts), started here when there's none.
  const [ranking, setRanking] = useState<{ ranking: PhotoRanking | null; job: RankingJob | null } | null>(null);
  const loadRanking = (isActive?: () => boolean) =>
    getJson<{ ranking: PhotoRanking | null; job: RankingJob | null }>(`/api/brief/ranking?piece=${encodeURIComponent(piece)}`).then(
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
  const rankingNow = ranking?.job?.state === 'working';
  const rank = () => {
    setError('');
    postJson<RankingJob>('/api/brief/rank-photos', { piece }).then((job) => setRanking((r) => ({ ranking: r?.ranking ?? null, job })), (e: Error) => setError(e.message));
  };
  const asked = useRef('');
  useEffect(() => {
    if (!ranking || ranked || rankingNow || ranking.job?.state === 'failed' || asked.current === choice.pick.title) return;
    asked.current = choice.pick.title;
    rank();
  }, [ranking, ranked, rankingNow, choice.pick.title]);
  useEffect(() => {
    if (!rankingNow) return;
    let active = true;
    const timer = setInterval(() => void loadRanking(() => active), 3000);
    return () => { active = false; clearInterval(timer); };
  }, [rankingNow, piece]);
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
        <button className="photo-choice" disabled={saving !== null} title={`Use ${p.name}`} onClick={() => pick(p.path)}>
          <img src={thumbUrl(root, photoPath, 320, p.revision)} alt={p.name} loading="lazy" />
        </button>
        {place !== undefined && <div className="photo-rank">#{place}{label && ` · ${label}`}</div>}
        <div className="photo-path">{p.path.replace(/\.[^.]+$/, '')}</div>
        {why && <div className="photo-why small-text">{why}</div>}
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
          {ranked && <span className="muted">· Claude looked at {ranked.looked} photos</span>}
          {ranked && !rankingNow && (
            <button className="small" onClick={rank} title="Searches the library using current expression tags, folders, ratings and stars">
              Rank Again
            </button>
          )}
        </p>
        {!!choice.pick.photoAttributes?.length && <p className="muted small-text">Photo Cues: {choice.pick.photoAttributes.map(tag => tag.replace(/([a-z])([A-Z])/g, '$1 $2')).join(', ')}</p>}
        {rankingNow && <p className="brief-working small-text">Claude is checking {ranking?.job?.looked} photos for a suitable camera photo…</p>}
        {ranking?.job?.state === 'failed' && !rankingNow && (
          <p className="error small-text">
            {ranking.job.error}{' '}
            <button className="small" onClick={rank}>
              Try Again
            </button>
          </p>
        )}
        {ranked && !ranked.ranked.length && !rankingNow && <p className="muted small-text">There are no suitable photos in this ranking. You can choose a photo below or add the expression to the Shot List.</p>}
        {ranked && !ranked.cameraFirst && !rankingNow && <p className="muted small-text">Use Rank Again to check this older ranking with camera photos first.</p>}
        {ranked && library && (
          <div className="photo-grid">
            {ranked.ranked.map((r, i) => {
              const found = library.photos.find((p) => p.path === r.photo);
              if (!found) return null;
              const aiLabel = isAiExpression(found) ? ranked.cameraFirst ? 'AI Fallback' : 'AI-Generated' : undefined;
              return tile(found, i + 1, r.why, aiLabel);
            })}
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

/** One of the brief's boxes: text, plus screenshots pasted or dropped into it, shown small with a ✕ each. */
function BriefBox({ label, value, onText, images, onImages, placeholder }: { label: string; value: string; onText: (v: string) => void; images: Pasted[]; onImages: (i: Pasted[]) => void; placeholder: string }) {
  const [error, setError] = useState('');
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

function Conversation({ piece, target, conversation, chosenPhoto, allDrafts, job, thumbs, onChanged }: { piece: string; target?: UseTarget; conversation: DraftConversation; chosenPhoto: string | null; allDrafts: DraftConversation[]; job?: ThumbJob; thumbs: ThumbJobs; onChanged?: () => void }) {
  // A photo of John chosen since this conversation started can go with a change request, as its new identity reference.
  const newPhoto = chosenPhoto && chosenPhoto !== conversation.photo ? chosenPhoto : null;
  const [sendPhoto, setSendPhoto] = useState(false);
  const rounds = [...conversation.images].reverse(); // newest first
  const [shown, setShown] = useState<string | undefined>(undefined);
  const current = rounds.find((r) => r.path === shown) ?? rounds[0];
  const [change, setChange] = useState('');
  const [refs, setRefs] = useState<Reference[]>([]);
  const [using, setUsing] = useState(false);
  const [used, setUsed] = useState('');
  // Use Thumbnail / Use Title / Use Both: the round on screen goes into the version selected on the card.
  const use = (thumbnail: boolean, title: boolean) => {
    if (!current || !target || target.locked) return;
    setUsing(true);
    setUsed('');
    setError('');
    postJson<{ done: string }>('/api/packaging/use-draft', { piece, image: current.path, version: target.path, thumbnail, title }).then(
      (r) => {
        setUsed(r.done);
        onChanged?.();
      },
      (e: Error) => setError(e.message),
    ).finally(() => setUsing(false));
  };
  const [error, setError] = useState('');
  const [copiedPath, setCopiedPath] = useState('');
  const working = job?.state === 'working';
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    readImages(files).then((more) => {
      if (!more.length) setError('Only PNG, JPEG or WebP images can be references.');
      setRefs((r) => [...r, ...more].slice(0, 4));
    }, (e: Error) => setError(e.message));
  };
  const withPhoto = !!newPhoto && sendPhoto;
  const ask = () => {
    setError('');
    const pasted = refs.flatMap((r) => (r.kind === 'pasted' ? [r.data] : []));
    const fromDrafts = refs.flatMap((r) => (r.kind === 'draft' ? [r.path] : []));
    const text = change.trim() || (withPhoto ? 'Use the newly chosen photo of John.' : '');
    postJson('/api/thumbs/change', { piece, conversation: conversation.path, text, pasted, drafts: fromDrafts, photo: withPhoto }).then(
      () => {
        setChange('');
        setRefs([]);
        setSendPhoto(false);
        setShown(undefined); // show the new image when it arrives
        thumbs.refresh();
      },
      (e: Error) => setError(e.message),
    );
  };
  // Every draft image of this video, for "use a draft as a reference".
  const draftImages = allDrafts.flatMap((c) => c.images.map((i) => ({ path: i.path, label: `${c.name} · ${i.name.replace(/\.[^.]+$/, '')}` })));
  return (
    <div className="thumb-draft">
      <h4>{conversation.name}</h4>
      {current ? (
        <a href={fileUrl('projects', current.path)} target="_blank" rel="noreferrer" title="Open full size">
          <img src={thumbUrl('projects', current.path, 640)} alt={`${conversation.name}, ${current.name}`} />
        </a>
      ) : (
        <p className="muted small-text">No images yet.</p>
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
      {conversation.pick && (
        <div className="draft-pair">
          <div className="draft-pair-title">{conversation.pick.title}</div>
          <div className="muted small-text">Thumbnail text: {conversation.pick.thumbnailText.toUpperCase()}</div>
        </div>
      )}
      {current && <ThumbnailFeedback key={current.path} piece={piece} image={current.path} hasMetadata={!!conversation.pick} />}
      {current && !working && target && (
        <div className="draft-use">
          <button className="small" disabled={using || copiedPath === current.path} onClick={() => { setUsing(true); setError(''); postJson<{ path: string }>('/api/expressions/inbox/copy-thumbnail', { piece, image: current.path }).then(result => { setCopiedPath(current.path); setUsed(`Copied to Expression Inbox: ${result.path}`); window.dispatchEvent(new Event('hq-expression-inbox-changed')); }, (e: Error) => setError(e.message)).finally(() => setUsing(false)); }}>Copy to Expression Inbox</button>
          <button className="small" disabled={using || target.locked} onClick={() => use(true, false)}>
            Use Thumbnail
          </button>
          {conversation.pick && (
            <>
              <button className="small" disabled={using || target.locked} onClick={() => use(false, true)}>
                Use Title
              </button>
              <button className="small" disabled={using || target.locked} onClick={() => use(true, true)}>
                Use Both
              </button>
            </>
          )}
          <span className="muted small-text">
            {using ? `Putting it in ${target.name}…` : target.locked ? `${target.name} is locked. Click its 🔒 above to unlock it.` : `Goes into ${target.name}, the version selected above.`}
          </span>
        </div>
      )}
      {used && <p className="small-text picked-label">{used}</p>}
      {working && <p className="brief-working small-text">{conversation.name.replace(/ \d+$/, '')} is working on it…</p>}
      {job?.state === 'failed' && <p className="error small-text">{job.error}</p>}
      {rounds.length > 0 && !working && (
        <div
          className="draft-change"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles([...e.dataTransfer.files]);
          }}
        >
          <textarea
            rows={2}
            value={change}
            onChange={(e) => setChange(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter((f): f is File => !!f);
              if (!files.length) return; // ordinary text
              e.preventDefault();
              addFiles(files);
            }}
            placeholder="What to change, e.g. make the rope look like the reference. Paste or drop an image here as a reference."
          />
          {refs.length > 0 && (
            <div className="ref-list">
              {refs.map((r, i) => (
                <div key={i} className="ref-item">
                  <img src={r.kind === 'pasted' ? r.preview : thumbUrl('projects', r.path, 240)} alt="Reference" />
                  <button className="small" title="Remove this reference" onClick={() => setRefs(refs.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {newPhoto && (
            <label className="new-photo-choice small-text">
              <input type="checkbox" checked={sendPhoto} onChange={(e) => setSendPhoto(e.target.checked)} />
              <span>
                Use the Photo Chosen Now: <strong>{newPhoto.split('/').pop()}</strong>
                {conversation.photo && <span className="muted"> (this conversation uses {conversation.photo.split('/').pop()})</span>}
              </span>
            </label>
          )}
          <div className="claude-buttons">
            <button className="small" disabled={!change.trim() && !withPhoto} onClick={ask}>
              Ask for Changes
            </button>
            {draftImages.length > 0 && refs.length < 4 && (
              <select
                className="small-text"
                value=""
                onChange={(e) => {
                  const d = draftImages.find((x) => x.path === e.target.value);
                  if (d) setRefs([...refs, { kind: 'draft', path: d.path, label: d.label }]);
                }}
              >
                <option value="">Add a draft as reference…</option>
                {draftImages.map((d) => (
                  <option key={d.path} value={d.path}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}
      {error && <p className="error small-text">{error}</p>}
      {conversation.requests && <TextToggle label="Requests" path={conversation.requests.path} />}
    </div>
  );
}

/** Review the image currently shown, independently of making another image. */
function ThumbnailFeedback({ piece, image, hasMetadata }: { piece: string; image: string; hasMetadata: boolean }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [reviews, setReviews] = useState<ThumbnailReview[]>([]);
  const [jobs, setJobs] = useState<ThumbnailReviewJob[]>([]);
  const [starting, setStarting] = useState<AiId[]>([]);
  const [error, setError] = useState('');
  const workingFeedback = jobs.some(job => job.state === 'working');
  useEffect(() => {
    if (!open) return;
    let active = true;
    const load = () => { void getJson<{ reviews: ThumbnailReview[]; jobs: ThumbnailReviewJob[] }>(`/api/thumbs/reviews?piece=${encodeURIComponent(piece)}&image=${encodeURIComponent(image)}`).then(data => { if (active) { setReviews(data.reviews); setJobs(data.jobs); setError(''); } }, (e: Error) => { if (active) setError(e.message); }); };
    load();
    return () => { active = false; };
  }, [open, piece, image]);
  useEffect(() => {
    if (!open || !workingFeedback) return;
    let active = true;
    const load = () => { void getJson<{ reviews: ThumbnailReview[]; jobs: ThumbnailReviewJob[] }>(`/api/thumbs/reviews?piece=${encodeURIComponent(piece)}&image=${encodeURIComponent(image)}`).then(data => { if (active) { setReviews(data.reviews); setJobs(data.jobs); setError(''); } }, (e: Error) => { if (active) setError(e.message); }); };
    const timer = setInterval(load, 4000);
    return () => { active = false; clearInterval(timer); };
  }, [open, workingFeedback, piece, image]);
  const ask = (ai: AiId) => {
    setError(''); setStarting(items => [...items, ai]);
    postJson<ThumbnailReviewJob>('/api/thumbs/reviews', { piece, image, ai, question }).then(job => setJobs(items => [...items.filter(item => item.ai !== ai), job]), (e: Error) => setError(e.message)).finally(() => setStarting(items => items.filter(item => item !== ai)));
  };
  return <details className="yt-section thumbnail-feedback" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Ask for Feedback</summary>
    <p className="muted small-text">Review this image{hasMetadata ? ' and the packaging generated with it' : ' (the generated packaging is unavailable for this older draft)'}. Feedback focuses on the expression and also checks the title, text and other available metadata. Reviews are saved on this computer.</p>
    <label>Question or Concern (Optional)<textarea rows={2} value={question} maxLength={4000} onChange={e => setQuestion(e.target.value)} placeholder="For example: Does my expression fit this title?" /></label>
    <div className="claude-buttons">{([{ ai: 'codex', name: 'ChatGPT' }, { ai: 'gemini', name: 'Gemini' }, { ai: 'claude', name: 'Claude' }] as const).map(({ ai, name }) => {
      const working = starting.includes(ai) || jobs.some(job => job.ai === ai && job.state === 'working');
      return <button key={ai} className="small" disabled={working} onClick={() => ask(ai)}>{working ? `${name} Is Reviewing…` : `Ask ${name}`}</button>;
    })}</div>
    {error && <p className="error" role="alert">{error}</p>}
    {jobs.filter(job => job.state === 'failed').map(job => <p className="error small-text" key={job.ai}>{job.ai === 'codex' ? 'ChatGPT' : job.ai === 'gemini' ? 'Gemini' : 'Claude'}: {job.error}</p>)}
    {reviews.map(review => <details key={review.id} className="feedback-review" open><summary><strong>{review.name}</strong> · {new Date(review.createdAt).toLocaleString()}{review.outdated && ' · Image Has Changed'}{review.packagingOutdated && ' · Packaging Has Changed'}</summary>
      {review.question && <p className="small-text"><strong>Question:</strong> {review.question}</p>}
      {review.outdated && <p className="comparison-edit-warning">This feedback is for an earlier image saved under the same name.</p>}
      {review.packagingOutdated && <p className="comparison-edit-warning">The generated packaging has changed since this feedback was requested.</p>}
      <div className="markdown"><Markdown remarkPlugins={[remarkGfm]}>{review.answer}</Markdown></div>
    </details>)}
  </details>;
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
