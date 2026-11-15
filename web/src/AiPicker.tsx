import { useEffect, useState } from 'react';
import { getJson, postJson, type AiId, type AiOverview, type SignIn } from './api';

const CHANGED = 'hq-ai-chosen';

/** Which AI is picked, kept the same everywhere on the page. Null until it has loaded. */
export function useAi(): { overview: AiOverview | null; choose: (id: AiId) => Promise<void> } {
  const [overview, setOverview] = useState<AiOverview | null>(null);
  useEffect(() => {
    const load = () => getJson<AiOverview>('/api/ai').then(setOverview, () => {});
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  const choose = (id: AiId) =>
    postJson('/api/ai', { id }).then(() => {
      window.dispatchEvent(new Event(CHANGED));
    });
  return { overview, choose };
}

/** The AI's name, for "Edit with ..." and the like. */
export function chosenName(overview: AiOverview | null): string {
  return overview?.options.find((o) => o.id === overview.chosen)?.name ?? 'AI';
}

/** At the top of the app: which AI the buttons use. */
export function AiPicker() {
  const { overview, choose } = useAi();
  const [error, setError] = useState<string | null>(null);
  if (!overview) return null;
  return (
    <>
    <label className="ai-picker small-text" title={error ?? 'Which AI does the jobs that buttons in this app start'}>
      AI
      <select
        value={overview.chosen}
        onChange={(e) => {
          setError(null);
          choose(e.target.value as AiId).catch((err: Error) => setError(err.message));
        }}
      >
        {overview.options.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.available}>
            {o.name}
            {!o.available ? ' (not installed)' : o.id === 'gemini' ? " (can't build CapCut projects)" : ''}
          </option>
        ))}
      </select>
      {error && <span className="error">{error}</span>}
    </label>
    <SignIns />
    </>
  );
}

/**
 * Whether each AI is signed in, checked when the app opens, when ↻ is clicked, and when John comes back to the app
 * after opening a sign-in. Sign In opens that AI's program in its own window, where he finishes in the browser.
 */
function SignIns() {
  const [signIns, setSignIns] = useState<SignIn[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(false);
  const check = () => {
    setChecking(true);
    getJson<SignIn[]>('/api/ai/sign-ins')
      .then(setSignIns, (e: Error) => setMessage(e.message))
      .finally(() => setChecking(false));
  };
  useEffect(check, []);
  // After a sign-in was opened: check again when John comes back to this window.
  useEffect(() => {
    if (!waiting) return;
    const back = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', back);
    return () => window.removeEventListener('focus', back);
  }, [waiting]);
  useEffect(() => {
    if (waiting && signIns?.every((s) => s.state === 'in')) {
      setWaiting(false);
      setMessage('');
    }
  }, [signIns, waiting]);
  const signIn = (s: SignIn) => {
    setMessage('');
    postJson<{ name: string }>('/api/ai/sign-in', { id: s.id }).then(
      () => {
        setWaiting(true);
        setMessage(
          s.id === 'gemini'
            ? 'Gemini opened in its own window. Sign in there if it asks, then close that window and come back here.'
            : `${s.name}'s sign-in opened in its own window and your browser. Finish signing in, then come back here.`,
        );
      },
      (e: Error) => setMessage(e.message),
    );
  };
  if (!signIns) return checking ? <span className="muted">Checking sign-ins…</span> : null;
  return (
    <span className="ai-signins">
      {signIns.map((s) => (
        <span key={s.id} className={`ai-signin ai-signin--${s.state}`} title={s.detail}>
          <span className="ai-signin-dot" aria-hidden="true" />
          {s.name}
          {s.state !== 'in' && (
            <button type="button" className="small" onClick={() => signIn(s)} title={s.state === 'out' ? 'Not signed in' : `Couldn't tell: ${s.detail}`}>
              Sign In
            </button>
          )}
        </span>
      ))}
      <button type="button" className="small ai-signin-check" disabled={checking} onClick={check} title="Check the sign-ins again">
        {checking ? '…' : '↻'}
      </button>
      {message && <span className="ai-signin-message">{message}</span>}
    </span>
  );
}
