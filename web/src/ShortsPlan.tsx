import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  fileUrl,
  getJson,
  postJson,
  type ClaudeRun,
  type PlannedShort,
  type ShortsOverview,
  type TimedWord,
} from './api';
import { ClaudeChat } from './ClaudeChat';
import { dragEdge, moveRow, nextShortId, parseTime, rangeOfWords, showTime, trimWindow, wordAt, wordInClip, type TrimWindow } from './shortsTime';

type Transcript = { file: string; words: TimedWord[] } | null;

// The shorts of a longform, on its page: Claude proposes a list (Shorts\Shorts Plan.json), John edits it here (every
// change is saved to that file straight away) and makes each short from its row.
export function ShortsPlanCard({ video }: { video: string }) {
  const [state, setState] = useState<ShortsOverview | null>(null);
  const [transcript, setTranscript] = useState<Transcript>(null);
  const [draft, setDraft] = useState('');
  const [making, setMaking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: Error) => setError(e.message);
  const refresh = () =>
    getJson<ShortsOverview>(`/api/shorts?video=${encodeURIComponent(video)}`).then((s) => {
      setState(s);
      return s;
    }, fail);

  useEffect(() => {
    setState(null);
    setTranscript(null);
    setDraft('');
    setError(null);
    refresh();
  }, [video]);

  const proposing = state?.run?.status === 'running';
  const hasPlan = !!state?.plan;
  useEffect(() => {
    getJson<Transcript>(`/api/shorts/transcript?video=${encodeURIComponent(video)}`).then(setTranscript, fail);
  }, [video, hasPlan]);

  // While Claude works on anything here, check for news every 2 seconds.
  const busy = proposing || Object.values(state?.builds ?? {}).some((b) => b.status === 'running');
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [busy, video]);

  // A screenshot pasted anywhere on the page is the retention graph. Text pastes carry on as normal.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type === 'image/png');
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const png = String(reader.result).split(',')[1];
        setError(null);
        postJson('/api/shorts/retention', { video, png }).then(refresh, fail);
      };
      reader.readAsDataURL(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [video]);

  if (!state) return null;

  const { plan, run, builds, exportFile, retention, drafts } = state;
  const source = draft || drafts[0] || '';

  const propose = () => {
    if (plan && !confirm('Propose a new list? Your current list is kept as a separate file in the Shorts folder.')) return;
    setError(null);
    postJson('/api/shorts/propose', { video }).then(refresh, fail);
  };
  const stop = (job: string) => postJson('/api/shorts/stop', { video, job }).then(refresh, fail);
  const send = (job: string, text: string) => {
    setError(null);
    postJson('/api/shorts/note', { video, job, text }).then(refresh, fail);
  };
  const save = (shorts: PlannedShort[], rejected: PlannedShort[]) => {
    setError(null);
    setState({ ...state, plan: { shorts, rejected } });
    postJson('/api/shorts/plan', { video, shorts, rejected }).catch((e) => {
      fail(e);
      refresh();
    });
  };
  const make = (s: PlannedShort) => {
    setError(null);
    setMaking(s.id);
    postJson('/api/shorts/make', { video, id: s.id, draft: source })
      .then(refresh, fail)
      .finally(() => setMaking(null));
  };

  const card = (s: PlannedShort, nearMiss: boolean) => {
    if (!plan) return null;
    const list = nearMiss ? plan.rejected : plan.shorts;
    const put = (rows: PlannedShort[]) => (nearMiss ? save(plan.shorts, rows) : save(rows, plan.rejected));
    return (
      <ShortCard
        key={s.id}
        short={s}
        nearMiss={nearMiss}
        words={transcript?.words ?? null}
        exportFile={exportFile}
        build={builds[s.id] ?? null}
        making={making === s.id}
        canMake={!!source && !making}
        onChange={(next) => put(list.map((x) => (x.id === s.id ? next : x)))}
        onDelete={() => put(list.filter((x) => x.id !== s.id))}
        onMove={() => {
          if (nearMiss) {
            const m = moveRow(plan.rejected, plan.shorts, s.id);
            save(m.to, m.from);
          } else {
            const m = moveRow(plan.shorts, plan.rejected, s.id);
            save(m.from, m.to);
          }
        }}
        onMake={() => make(s)}
        onSend={(text) => send(`short-${s.id}`, text)}
        onStop={() => stop(`short-${s.id}`)}
      />
    );
  };

  return (
    <div className="card shorts-plan">
      <div className="tool-head">
        <h4>Shorts from this video</h4>
        {proposing ? (
          <button onClick={() => stop('shorts')}>Stop</button>
        ) : (
          <button onClick={propose}>{plan ? 'Propose again' : 'Propose shorts'}</button>
        )}
      </div>

      <div className="retention small-text">
        {retention ? (
          <>
            <a href={fileUrl('projects', retention.path)} target="_blank" rel="noreferrer">
              <img src={`${fileUrl('projects', retention.path)}&v=${retention.version}`} alt="Retention graph" />
            </a>
            <div>
              <div>Retention graph. Claude looks at it the next time you click Propose.</div>
              <div className="muted">Paste another screenshot to replace it.</div>
              <button
                className="small"
                onClick={() => postJson('/api/shorts/retention/remove', { video }).then(refresh, fail)}
              >
                Stop using it
              </button>
            </div>
          </>
        ) : (
          <span className="muted">Retention graph: copy a screenshot of it, then press Ctrl+V anywhere on this page.</span>
        )}
      </div>

      {!proposing && !plan && run?.status === 'idle' && <p className="error">Claude finished without writing a list.</p>}
      {state.planError && <p className="error">{state.planError}</p>}
      {error && <p className="error">{error}</p>}

      {run && (
        <details className="shorts-talk" open={proposing || undefined}>
          <summary className="small-text">Talk to Claude about this list</summary>
          <ClaudeChat
            run={run}
            placeholder="An answer, or what to change in the list"
            onSend={(text) => send('shorts', text)}
            onStop={() => stop('shorts')}
          />
        </details>
      )}

      {plan && !proposing && (
        <>
          {drafts.length > 1 && (
            <label className="shorts-source small-text">
              Copy each short from the CapCut project{' '}
              <select value={source} onChange={(e) => setDraft(e.target.value)}>
                {drafts.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          )}
          {drafts.length === 0 && <p className="error small-text">No CapCut project matches this video, so shorts can't be made yet.</p>}
          {!transcript && <p className="muted small-text">This video has no word-by-word transcript, so clips can't show their words.</p>}
          {!exportFile && <p className="muted small-text">Export the longform into Longform\Exports to preview clips here.</p>}

          {plan.shorts.map((s) => card(s, false))}
          <button
            className="small"
            onClick={() => {
              const last = plan.shorts[plan.shorts.length - 1];
              const start = last ? last.end : 0;
              const id = nextShortId([...plan.shorts, ...plan.rejected].map((s) => s.id));
              save([...plan.shorts, { id, title: 'New Short', start, end: start + 45, proposed: null }], plan.rejected);
            }}
          >
            Add a short
          </button>

          {plan.rejected.length > 0 && (
            <details className="near-misses" open>
              <summary>Near misses ({plan.rejected.length})</summary>
              {plan.rejected.map((s) => card(s, true))}
            </details>
          )}
        </>
      )}
    </div>
  );
}

type Clip = { start: number; end: number };

function ShortCard({
  short,
  nearMiss,
  words,
  exportFile,
  build,
  making,
  canMake,
  onChange,
  onDelete,
  onMove,
  onMake,
  onSend,
  onStop,
}: {
  short: PlannedShort;
  nearMiss: boolean;
  words: TimedWord[] | null;
  exportFile: string | null;
  build: ClaudeRun | null;
  making: boolean;
  canMake: boolean;
  onChange: (next: PlannedShort) => void;
  onDelete: () => void;
  onMove: () => void;
  onMake: () => void;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  // The insides, the video above all, exist only while the card is open.
  const [open, setOpen] = useState(false);
  // Where the handles are during a drag. Saved to the plan only when the mouse lets go.
  const [dragged, setDragged] = useState<Clip | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = dragged ?? short;
  const length = clip.end - clip.start;
  const total = Math.max(clip.end, duration ?? words?.[words.length - 1]?.end ?? clip.end + 60);
  // The engine remembers Claude's times too (and has the last word). This shows the button straight away.
  const proposed = short.proposed === undefined ? { start: short.start, end: short.end } : short.proposed;
  const setClip = ({ start, end }: Clip) => {
    setDragged(null);
    if (start !== short.start || end !== short.end) onChange({ ...short, start, end, proposed });
  };
  const made = !!short.made;
  const status = making
    ? 'copying the CapCut project…'
    : build?.status === 'running'
      ? 'Claude is working…'
      : made
        ? 'made'
        : null;

  return (
    <details className="short-card" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="muted">{short.id}</span>
        <span className="short-card-title">{short.title}</span>
        <span className="muted small-text">
          {showTime(clip.start)} · {Math.round(length)} s{short.score !== undefined && ` · score ${short.score}`}
          {nearMiss && short.reason && ` · ${short.reason}`}
        </span>
        {status && <span className="short-status small-text">{status}</span>}
      </summary>
      {open && (
        <div className="short-card-body">
          {made && <p className="small-text">Made as "{short.made}". To change it now, tell Claude below.</p>}
          <div className="short-fields">
            <label>
              Title
              <TextField
                className="shorts-title"
                value={short.title}
                disabled={made}
                onCommit={(title) => onChange({ ...short, title })}
              />
            </label>
            <label>
              Number
              <TextField
                className="shorts-number"
                value={short.id}
                disabled={made}
                onCommit={(id) => onChange({ ...short, id })}
              />
            </label>
            <label>
              Start
              <TimeField value={clip.start} disabled={made} onCommit={(start) => setClip({ start, end: short.end })} />
            </label>
            <label>
              End
              <TimeField value={clip.end} disabled={made} onCommit={(end) => setClip({ start: short.start, end })} />
            </label>
            <div className="short-length">
              Length
              <span>{length.toFixed(1)} seconds</span>
            </div>
          </div>
          {short.why && <p className="small-text">{short.why}</p>}
          {short.visuals && <p className="small-text">On screen: {short.visuals}</p>}
          {nearMiss && short.reason && <p className="muted small-text">Not chosen: {short.reason}</p>}

          <div className="short-preview">
            {exportFile && (
              <ClipPlayer
                videoRef={videoRef}
                src={fileUrl('projects', exportFile)}
                start={short.start}
                end={short.end}
                onDuration={setDuration}
              />
            )}
            {words && <TranscriptPicker words={words} start={clip.start} end={clip.end} disabled={made} videoRef={videoRef} onPick={setClip} />}
          </div>
          {!made && (exportFile || words) && (
            <TrimBar clip={clip} total={total} words={words} videoRef={videoRef} onMove={setDragged} onDone={setClip} />
          )}
          {!made && proposed && (proposed.start !== clip.start || proposed.end !== clip.end) && (
            <button className="small" onClick={() => setClip(proposed)}>
              Back to Claude's clip ({showTime(proposed.start)} to {showTime(proposed.end)})
            </button>
          )}

          <div className="short-buttons">
            {!made && (
              <>
                <button disabled={!canMake} onClick={onMake}>
                  {making ? 'Copying the CapCut project…' : 'Make this short'}
                </button>
                <button className="small" onClick={onMove}>
                  {nearMiss ? 'Move to shorts' : 'Move to near misses'}
                </button>
                <button className="small" onClick={() => confirm(`Remove "${short.title}" from the list?`) && onDelete()}>
                  Remove
                </button>
              </>
            )}
          </div>

          {build && (
            <ClaudeChat
              run={build}
              placeholder="What to change, or what you changed yourself in CapCut"
              onSend={onSend}
              onStop={onStop}
            />
          )}
        </div>
      )}
    </details>
  );
}

/** The longform's export, queued up at the clip. "Play this clip" stops at its end; the normal controls don't. */
function ClipPlayer({
  videoRef,
  src,
  start,
  end,
  onDuration,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  start: number;
  end: number;
  onDuration: (seconds: number) => void;
}) {
  const stopTimer = useRef(0);
  const endRef = useRef(end);
  endRef.current = end;

  // Moves to the new start when John changes it (once the video has loaded, onLoadedMetadata does the first move).
  useEffect(() => {
    const v = videoRef.current;
    if (v && v.readyState > 0 && v.paused) v.currentTime = start;
  }, [start]);

  useEffect(() => () => cancelAnimationFrame(stopTimer.current), []);

  // Checked every screen refresh, because judging a cut needs the video to stop right on it.
  const stopAtEnd = () => {
    const v = videoRef.current;
    if (!v || v.paused) return;
    if (v.currentTime >= endRef.current) v.pause();
    else stopTimer.current = requestAnimationFrame(stopAtEnd);
  };

  return (
    <div className="clip-player">
      <video
        ref={videoRef}
        src={src}
        controls
        preload="metadata"
        onLoadedMetadata={(e) => {
          onDuration(e.currentTarget.duration);
          e.currentTarget.currentTime = start;
        }}
        onPlay={(e) => {
          // One clip at a time.
          document.querySelectorAll('.clip-player video').forEach((o) => {
            if (o !== e.currentTarget) (o as HTMLVideoElement).pause();
          });
        }}
        onPause={() => cancelAnimationFrame(stopTimer.current)}
      />
      <button
        className="small"
        onClick={() => {
          const v = videoRef.current;
          if (!v) return;
          cancelAnimationFrame(stopTimer.current);
          v.currentTime = start;
          void v.play().then(stopAtEnd);
        }}
      >
        Play this clip
      </button>
    </div>
  );
}

/**
 * The trim bar under the video: drag a handle to move the start or end, and the video shows that frame.
 * The pale marks are the words, so the gaps show where John pauses. Click the bar to jump the video there.
 */
function TrimBar({
  clip,
  total,
  words,
  videoRef,
  onMove,
  onDone,
}: {
  clip: Clip;
  total: number;
  words: TimedWord[] | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  onMove: (next: Clip) => void;
  onDone: (next: Clip) => void;
}) {
  const [shown, setShown] = useState<TrimWindow>(() => trimWindow(clip.start, clip.end, total));
  const [dragging, setDragging] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const latest = useRef(clip);
  const waiting = useRef<number | null>(null);

  useEffect(() => {
    if (!dragging) setShown((was) => trimWindow(clip.start, clip.end, total, was));
  }, [clip.start, clip.end, total, dragging]);

  const percent = (t: number) => `${((t - shown.from) / (shown.to - shown.from)) * 100}%`;
  const timeAt = (x: number) => {
    const box = track.current!.getBoundingClientRect();
    return shown.from + (Math.max(0, Math.min(x - box.left, box.width)) / box.width) * (shown.to - shown.from);
  };

  // A big export is slow to seek, so a drag asks for one frame at a time: the newest once the last has arrived.
  const seek = (t: number) => {
    const v = videoRef.current;
    if (!v || v.readyState === 0) return;
    if (v.seeking) waiting.current = t;
    else v.currentTime = t;
  };
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = () => {
      if (waiting.current === null) return;
      v.currentTime = waiting.current;
      waiting.current = null;
    };
    v.addEventListener('seeked', next);
    return () => v.removeEventListener('seeked', next);
  }, []);

  // The playhead follows the video directly, so playing doesn't redraw the rest of the card.
  useEffect(() => {
    let timer = 0;
    const follow = () => {
      const v = videoRef.current;
      const line = playhead.current;
      if (line) {
        const inView = !!v && v.readyState > 0 && v.currentTime >= shown.from && v.currentTime <= shown.to;
        line.style.display = inView ? 'block' : 'none';
        if (v && inView) line.style.left = percent(v.currentTime);
      }
      timer = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(timer);
  }, [shown.from, shown.to]);

  const handle = (edge: 'start' | 'end') => ({
    role: 'slider',
    tabIndex: 0,
    title: 'Drag, or use the arrow keys for a tenth of a second',
    'aria-label': edge === 'start' ? 'Clip start' : 'Clip end',
    'aria-valuemin': 0,
    'aria-valuemax': total,
    'aria-valuenow': clip[edge],
    'aria-valuetext': showTime(clip[edge]),
    className: `trim-handle trim-handle-${edge}`,
    style: { left: percent(clip[edge]) },
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      videoRef.current?.pause();
      latest.current = clip;
      setDragging(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      latest.current = dragEdge(edge, timeAt(e.clientX), latest.current, total, words);
      onMove(latest.current);
      seek(latest.current[edge]);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      setDragging(false);
      onDone(latest.current);
    },
    onPointerCancel: () => {
      setDragging(false);
      onDone(clip);
    },
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = e.key === 'ArrowLeft' ? -0.1 : e.key === 'ArrowRight' ? 0.1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = dragEdge(edge, clip[edge] + step, clip, total, null);
      onDone(next);
      seek(next[edge]);
    },
  });

  return (
    <div className="trim">
      <div className="trim-track" ref={track} onPointerDown={(e) => seek(timeAt(e.clientX))}>
        {words && (
          <svg className="trim-words" viewBox={`${shown.from} 0 ${shown.to - shown.from} 1`} preserveAspectRatio="none" aria-hidden>
            {words
              .filter((w) => w.end > shown.from && w.start < shown.to)
              .map((w, i) => (
                <rect key={i} x={w.start} width={w.end - w.start} y={0.3} height={0.4} />
              ))}
          </svg>
        )}
        <div className="trim-range" style={{ left: percent(clip.start), right: `calc(100% - ${percent(clip.end)})` }} />
        <div className="trim-playhead" ref={playhead} />
        <div {...handle('start')} />
        <div {...handle('end')} />
      </div>
      <div className="trim-scale muted small-text">
        <span>{showTime(shown.from)}</span>
        <span>Drag the handles. Near the edge, let go and the bar moves along.</span>
        <span>{showTime(shown.to)}</span>
      </div>
    </div>
  );
}

/**
 * The whole transcript, scrolled to the clip, with the clip's words highlighted. Words selected with the mouse,
 * inside or outside the clip, can become the clip with one click.
 */
function TranscriptPicker({
  words,
  start,
  end,
  disabled,
  videoRef,
  onPick,
}: {
  words: TimedWord[];
  start: number;
  end: number;
  disabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
  onPick: (next: Clip) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<[number, number] | null>(null);

  const inClip = words.map((w) => wordInClip(w, start, end));
  const first = inClip.indexOf(true);
  const last = inClip.lastIndexOf(true);

  // Keeps the edge being moved in view. Scrolls only this box, never the page.
  const reveal = (i: number) => {
    const list = box.current;
    const word = list?.children[i] as HTMLElement | undefined;
    if (!list || !word) return;
    const margin = 2 * word.offsetHeight;
    if (word.offsetTop < list.scrollTop + margin) list.scrollTop = word.offsetTop - margin;
    else if (word.offsetTop + word.offsetHeight > list.scrollTop + list.clientHeight - margin) {
      list.scrollTop = word.offsetTop + word.offsetHeight + margin - list.clientHeight;
    }
  };
  useEffect(() => reveal(last), [last]);
  useEffect(() => reveal(first), [first]);

  // Lights the word being said. This sets a mark on that one word directly, so playing doesn't redraw the whole
  // transcript. The box follows along only while playing, so it doesn't move while John is selecting.
  useEffect(() => {
    let timer = 0;
    let lit = -1;
    const follow = () => {
      const list = box.current;
      const v = videoRef.current;
      if (list && v && v.readyState > 0) {
        const now = wordAt(words, v.currentTime);
        if (now !== lit) {
          list.children[lit]?.removeAttribute('data-speaking');
          list.children[now]?.setAttribute('data-speaking', '');
          lit = now;
          if (now >= 0 && !v.paused) reveal(now);
        }
      }
      timer = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(timer);
  }, [words]);

  useEffect(() => {
    if (disabled) return;
    const onSelect = () => {
      const list = box.current;
      const selection = getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      if (!list || !range || !list.contains(range.commonAncestorContainer)) return setPicked(null);
      let from = -1;
      let to = -1;
      for (let i = 0; i < list.children.length; i++) {
        const span = list.children[i];
        if (!range.intersectsNode(span)) continue;
        const text = span.firstChild as Text;
        // A selection that merely touches a word, ending just before it or starting just after it, doesn't include it.
        if ((range.endContainer === span || range.endContainer === text) && range.endOffset === 0) continue;
        if (range.startContainer === text && range.startOffset >= text.length) continue;
        if (from < 0) from = i;
        to = i;
      }
      setPicked((was) => (from < 0 ? null : was && was[0] === from && was[1] === to ? was : [from, to]));
    };
    document.addEventListener('selectionchange', onSelect);
    return () => document.removeEventListener('selectionchange', onSelect);
  }, [disabled, words]);

  const range = picked && rangeOfWords(words, picked[0], picked[1]);

  return (
    <div className="short-transcript">
      <div className="short-words small-text" ref={box}>
        {words.map((w, i) => (
          <span key={i} className={inClip[i] ? 'in-clip' : undefined}>
            {`${w.word} `}
          </span>
        ))}
      </div>
      {!disabled &&
        (range ? (
          // Stops the click from clearing the selection before it's read.
          <button
            className="small"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              getSelection()?.removeAllRanges();
              setPicked(null);
              onPick(range);
            }}
          >
            Use the selected words as the clip ({showTime(range.start)} to {showTime(range.end)},{' '}
            {(range.end - range.start).toFixed(1)} seconds)
          </button>
        ) : (
          <p className="muted small-text">Select words with the mouse to make them the clip.</p>
        ))}
    </div>
  );
}

/** A text box that saves when you leave it. */
function TextField({
  className,
  value,
  disabled,
  onCommit,
}: {
  className: string;
  value: string;
  disabled: boolean;
  onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={className}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
    />
  );
}

/** A minutes:seconds box. What isn't a time goes back to the saved value. */
function TimeField({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(showTime(value));
  useEffect(() => setText(showTime(value)), [value]);
  return (
    <input
      className="shorts-time"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const t = parseTime(text);
        if (t === null) setText(showTime(value));
        else if (showTime(t) !== showTime(value)) onCommit(t);
      }}
    />
  );
}
