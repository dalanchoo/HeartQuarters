import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, type ClaudeRun } from './api';

/** From the engine: whether the button says Generate or Regenerate, and whether it can be used. */
interface PieceState {
  generated: boolean;
  canGenerate: boolean;
  reason?: string;
}
import { chosenName, useAi } from './AiPicker';
import { ClaudeChat } from './ClaudeChat';

// The AI box at the top of every card on a video's page, the same for the longform and each short: the piece's
// conversation, Generate / Regenerate and "Write YouTube metadata". Changes to a piece are notes in the conversation. A standalone short has no longform, so no AI jobs yet.
export function PieceAI({
  video,
  piece,
  draft,
  canEdit,
  onFinished,
}: {
  /** The video's id, or undefined for a standalone short. */
  video?: string;
  /** "Longform", or the short's folder name. */
  piece: string;
  /** Its CapCut project. */
  draft: string;
  /** True for a longform, false for a short. */
  canEdit: boolean;
  /** Called when the AI finishes a turn, so the card can show what it wrote. */
  onFinished: () => void;
}) {
  const [run, setRun] = useState<ClaudeRun | null>(null);
  const [state, setState] = useState<PieceState | null>(null);
  const [starting, setStarting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = chosenName(useAi().overview);
  const query = video ? `video=${encodeURIComponent(video)}&piece=${encodeURIComponent(piece)}` : '';
  const wasBusy = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const fail = (e: Error) => setError(e.message);
  const refresh = () => {
    getJson<PieceState>(`/api/piece-ai/state?${query}`).then(setState, fail);
    return getJson<ClaudeRun | null>(`/api/piece-ai?${query}`).then((r) => {
      setRun(r);
      setLoaded(true);
    }, fail);
  };

  useEffect(() => {
    if (query) refresh();
  }, [query]);

  const busy = run?.status === 'running' || starting;
  useEffect(() => {
    if (wasBusy.current && !busy) onFinished();
    wasBusy.current = busy;
    if (!busy) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [busy, query]);

  if (!video) {
    return (
      <div className="card piece-ai">
        <h4>AI</h4>
        <p className="muted small-text">AI jobs need a longform to work from, so they aren't available for standalone shorts yet.</p>
      </div>
    );
  }
  if (!loaded) return null;

  const act = (url: string, data: object = {}) => {
    setError(null);
    postJson<ClaudeRun>(url, { video, piece, ...data }).then(setRun, fail);
  };

  const generate = () => {
    const regenerate = !!state?.generated;
    const what = canEdit ? 'this longform' : 'this short';
    if (
      regenerate &&
      !window.confirm(
        `Are you sure you want to regenerate ${what}?\n\nThe CapCut project "${draft}" goes to the HeartQuarters Trash folder, ` +
          `and ${name} starts again from scratch. Everything you changed in CapCut is lost from the new project.`,
      )
    )
      return;
    setError(null);
    setStarting(true);
    postJson<ClaudeRun>('/api/piece-ai/generate', { video, piece, regenerate })
      .then(setRun, fail)
      .finally(() => {
        setStarting(false);
        refresh();
      });
  };
  const generateTitle = !state?.canGenerate
    ? state?.reason
    : state.generated
      ? `Throws this CapCut project away (to the trash) and makes it again from scratch. Asks first.`
      : 'Makes the CapCut project and the first cut from the takes';

  return (
    <div className="card piece-ai" ref={box}>
      <h4>AI · CapCut project "{draft}"</h4>
      <div className="piece-ai-buttons">
        <button disabled={busy || !state?.canGenerate} title={generateTitle} onClick={generate}>
          {starting ? 'Starting…' : state?.generated ? 'Regenerate' : 'Generate'}
        </button>
        <button disabled={busy} onClick={() => act('/api/piece-ai/metadata')}>
          Write YouTube metadata
        </button>
        {!busy && <span className="muted small-text">{name} fills in YouTube.md. You don't need to export first.</span>}
      </div>
      {run && !busy && (
        <button
          className="small piece-ai-clear"
          onClick={() => {
            setError(null);
            postJson('/api/piece-ai/clear', { video, piece }).then(() => setRun(null), fail);
          }}
        >
          Clear conversation
        </button>
      )}
      {run ? (
        <ClaudeChat
          run={run}
          placeholder="What to change, or what you changed yourself in CapCut"
          onSend={(text) => act('/api/piece-ai/note', { text })}
          onStop={() => act('/api/piece-ai/stop')}
        />
      ) : (
        <div className="claude-reply">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={`Ask ${name} to change something in this ${canEdit ? 'longform' : 'short'}`}
          />
          <div className="claude-buttons">
            <button
              disabled={!note.trim()}
              onClick={() => {
                act('/api/piece-ai/note', { text: note });
                setNote('');
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
      {state && !state.canGenerate && <p className="muted small-text">{state.reason}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
