import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fileUrl, getJson, getText, openInExplorer, postJson, thumbUrl, type BriefChoice, type BriefJob, type BriefPick, type BriefSource, type DraftConversation, type Drafts, type ExpressionIndex, type ThumbJob } from './api';
import { categoriesIn, photosIn } from './expressionPick';
import { CopyButton } from './PackagingDoc';
import { combineNotes, researchQuestion, type ResearchFacts } from './researchPrompt';

// The card's "Thumbnail & Title Drafts" section: the brainstorming in Packaging\Drafts before a version is made.
// At the top, Write Brief: Claude writes Brief.md, ChatGPT and Gemini review it, and Claude picks the top 3 title and
// thumbnail pairs (server/brief.ts). The top 3 show as cards to choose from; the full brief opens below them, then one
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
        Thumbnail & Title Drafts{' '}
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
              <Conversation key={c.path} piece={piece} target={target} conversation={c} allDrafts={drafts.conversations} job={thumbs.jobs.find((j) => j.conversation === c.path)} thumbs={thumbs} onChanged={onChanged} />
            ))}
          </div>
        </>
      )}
    </details>
  );
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
  const load = () =>
    getJson<ThumbJob[]>(`/api/thumbs?piece=${encodeURIComponent(piece)}`).then((list) => {
      const finished = list.some((j) => before.current[j.conversation] === 'working' && j.state !== 'working');
      before.current = Object.fromEntries(list.map((j) => [j.conversation, j.state]));
      setJobs(list);
      if (finished) onChanged?.();
    }, () => undefined);
  useEffect(() => {
    if (open) void load();
  }, [open, piece]);
  const working = jobs.some((j) => j.state === 'working');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [working]);
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
  const chosen = choice && picks[choice.index]?.title === choice.pick.title ? choice.index : null;
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
            <p className="small-text"><span className="muted">Background:</span> {p.background}</p>
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
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    getJson<ExpressionIndex>('/api/expressions').then(setLibrary, (e: Error) => setError(e.message));
  }, []);
  // The pair's own categories first, then any John adds from the whole library.
  const [added, setAdded] = useState<string[]>([]);
  const categories = [...categoriesIn(choice.pick.expression), ...added.filter((c) => !categoriesIn(choice.pick.expression).includes(c))];
  const pick = (photo: string) => {
    setSaving(photo);
    setError('');
    postJson('/api/brief/photo', { piece, photo }).then(() => onChanged?.(), (e: Error) => setError(e.message)).finally(() => setSaving(null));
  };
  const tile = (p: { path: string; name: string }) => {
    const picked = choice.photo === p.path;
    const root = p.path.startsWith('project:') ? 'projects' : 'expressions';
    const photoPath = root === 'projects' ? p.path.slice(8) : p.path;
    return (
      <div key={p.path} className={`photo-tile${picked ? ' picked' : ''}`}>
        <button className="photo-choice" disabled={saving !== null} title={`Use ${p.name}`} onClick={() => pick(p.path)}>
          <img src={thumbUrl(root, photoPath, 320)} alt={p.name} loading="lazy" />
        </button>
        <div className="photo-path">{p.path.replace(/\.[^.]+$/, '')}</div>
        <div className="photo-tile-foot">
          {picked ? <span className="picked-label">✓ Picked</span> : saving === p.path ? <span className="muted">Saving…</span> : null}
          <a href={fileUrl(root, photoPath)} target="_blank" rel="noreferrer">
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
        Click a photo to use it for this pair; Full Size opens the whole photo. With your portrait on the left, choose one where you look at the
        camera or to your left (toward the text), not away from it.
      </p>
      {choice.photo && (
        <div className="photo-group">
          <p className="small-text"><strong>Your photo</strong></p>
          <div className="photo-grid">{tile({ path: choice.photo, name: choice.photo.split('/').pop() ?? choice.photo })}</div>
        </div>
      )}
      {!library && !error && <p className="muted small-text">Loading the expressions library…</p>}
      {library && categories.length === 0 && <p className="muted small-text">This pair names no library category. Add one below.</p>}
      {library &&
        categories.map((c) => {
          const photos = photosIn(library.photos, c);
          return (
            <div key={c} className="photo-group">
              <p className="small-text">
                <strong>{c}</strong> <span className="muted">· {photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
                {added.includes(c) && (
                  <button className="small" onClick={() => setAdded(added.filter((a) => a !== c))}>
                    Remove
                  </button>
                )}
              </p>
              {photos.length ? (
                <div className="photo-grid">{photos.map(tile)}</div>
              ) : (
                <p className="muted small-text">No photos in this category yet. Add another category below.</p>
              )}
            </div>
          );
        })}
      {library && (
        <label className="small-text add-category">
          Show photos from another category:{' '}
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) setAdded([...added.filter((a) => a !== e.target.value), e.target.value]);
            }}
          >
            <option value="">Choose a category…</option>
            {library.categories
              .filter((c) => c.path && !categories.includes(c.path))
              .map((c) => (
                <option key={c.path} value={c.path} disabled={c.totalCount === 0}>
                  {c.path} ({c.totalCount ? `${c.totalCount} ${c.totalCount === 1 ? 'photo' : 'photos'}` : 'no photos yet'})
                </option>
              ))}
          </select>
        </label>
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

function WriteBrief({ piece, hasBrief, hasPicks, research, onChanged }: { piece: string; hasBrief: boolean; hasPicks: boolean; research?: Research; onChanged?: () => void }) {
  // Screenshots pasted into the boxes. Unlike the text, they aren't kept over a reload (too big for the browser's storage).
  const [shots, setShots] = useState<Record<BoxName, Pasted[]>>({ notes: [], vidiq: [], studio: [] });
  const images = { notes: shots.notes.map((s) => s.data), vidiq: shots.vidiq.map((s) => s.data), studio: shots.studio.map((s) => s.data) };
  const [source, setSource] = useState<BriefSource | null | undefined>(undefined);
  const [job, setJob] = useState<BriefJob | null>(null);
  const [boxes, setBox] = useBriefBoxes(piece);
  // The AIs get the three boxes as one text, each part under its own heading.
  const notes = combineNotes(boxes.notes, boxes.vidiq, boxes.studio);
  const question = research ? researchQuestion(research) : '';
  const [error, setError] = useState('');
  const wasRunning = useRef(false);

  const load = () =>
    getJson<{ source: BriefSource | null; job: BriefJob | null }>(`/api/brief?piece=${encodeURIComponent(piece)}`).then(
      (r) => {
        setSource(r.source);
        setJob(r.job);
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => void load(), [piece]);

  // While the AIs work, check every few seconds. When they finish, the card reloads to show the new brief.
  const running = job?.status === 'running';
  useEffect(() => {
    if (running) wasRunning.current = true;
    else if (wasRunning.current) {
      wasRunning.current = false;
      onChanged?.();
    }
    if (!running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [running]);

  const start = () => {
    if (hasBrief && !window.confirm('Write a new brief? The current Brief.md is kept, renamed with its date and time.')) return;
    setError('');
    postJson<BriefJob>('/api/brief/start', { piece, notes, images }).then(setJob, (e: Error) => setError(e.message));
  };
  // For a brief written before there were picks, or to pick again: only Claude's last step, about a minute.
  const pick = () => {
    setError('');
    postJson<BriefJob>('/api/brief/picks', { piece, notes, images }).then(setJob, (e: Error) => setError(e.message));
  };

  if (source === undefined) return error ? <p className="error">{error}</p> : null;
  return (
    <div className="write-brief">
      <p className="muted small-text">
        {source
          ? `Made from the ${source.kind}: ${source.path.split('/').pop()}. Claude writes the brief with vidIQ research (a few vidIQ credits), ChatGPT and Gemini each add a review, and Claude picks the top 3. It takes several minutes.`
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
                  <a className="small-link" href={`https://studio.youtube.com/video/${research.videoId}/edit`} target="_blank" rel="noreferrer">
                    Open This Video in Studio ↗
                  </a>
                )}
              </div>
            </details>
          )}
          <BriefBox label="Notes for the AIs" value={boxes.notes} onText={(v) => setBox('notes', v)} images={shots.notes} onImages={(i) => setShots({ ...shots, notes: i })} placeholder="Optional: for example what you don't like about the current thumbnail, or which version is on YouTube" />
          <BriefBox label="vidIQ's answer" value={boxes.vidiq} onText={(v) => setBox('vidiq', v)} images={shots.vidiq} onImages={(i) => setShots({ ...shots, vidiq: i })} placeholder="Paste what vidIQ suggested, such as its title and tag scores" />
          <BriefBox label="Ask Studio's answer" value={boxes.studio} onText={(v) => setBox('studio', v)} images={shots.studio} onImages={(i) => setShots({ ...shots, studio: i })} placeholder="Paste what Ask Studio suggested" />
          <div className="claude-buttons">
            <button className="small" onClick={start}>
              {hasBrief ? 'Write New Brief' : 'Write Brief'}
            </button>
            {hasBrief && (
              <button className="small" onClick={pick} title="Claude reads the brief and its reviews and picks the top 3 pairs again (about a minute)">
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
              {s.name} {s.role === 'writes' ? 'writes the brief' : s.role === 'reviews' ? 'reviews it' : 'picks the top 3'}: {STATE_WORDS[s.state]}
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
              resolve({ kind: 'pasted', data: url.split(',')[1] ?? '', preview: url });
            };
            reader.readAsDataURL(f);
          }),
      ),
  );
}

function Conversation({ piece, target, conversation, allDrafts, job, thumbs, onChanged }: { piece: string; target?: UseTarget; conversation: DraftConversation; allDrafts: DraftConversation[]; job?: ThumbJob; thumbs: ThumbJobs; onChanged?: () => void }) {
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
  const working = job?.state === 'working';
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    readImages(files).then((more) => {
      if (!more.length) setError('Only PNG, JPEG or WebP images can be references.');
      setRefs((r) => [...r, ...more].slice(0, 4));
    }, (e: Error) => setError(e.message));
  };
  const ask = () => {
    setError('');
    const pasted = refs.flatMap((r) => (r.kind === 'pasted' ? [r.data] : []));
    const fromDrafts = refs.flatMap((r) => (r.kind === 'draft' ? [r.path] : []));
    postJson('/api/thumbs/change', { piece, conversation: conversation.path, text: change, pasted, drafts: fromDrafts }).then(
      () => {
        setChange('');
        setRefs([]);
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
      {current && !working && target && (
        <div className="draft-use">
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
          <div className="claude-buttons">
            <button className="small" disabled={!change.trim()} onClick={ask}>
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
