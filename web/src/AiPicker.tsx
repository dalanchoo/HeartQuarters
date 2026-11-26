import { useEffect, useState } from 'react';
import { getJson, postJson, type AiId, type AiOverview, type SignIn } from './api';

const CHANGED = 'hq-ai-chosen';

/** The AIs: whether each is installed and which model it uses. Null until it has loaded. */
export function useAi(): { overview: AiOverview | null; chooseModel: (id: AiId, model: string) => Promise<void> } {
  const [overview, setOverview] = useState<AiOverview | null>(null);
  useEffect(() => {
    const load = () => getJson<AiOverview>('/api/ai').then(setOverview, () => {});
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  const chooseModel = (id: AiId, model: string) =>
    postJson('/api/ai', { id, model }).then(() => {
      window.dispatchEvent(new Event(CHANGED));
    });
  return { overview, chooseModel };
}

/**
 * At the top of the app: each AI's sign-in status. Which model each AI uses is set on the Tools page, and which AI
 * does a job is chosen next to each button (AiChoice.tsx).
 */
export function AiPicker() {
  const { overview } = useAi();
  if (!overview) return null;
  return (
    <div className="ai-controls">
      <SignIns overview={overview} />
    </div>
  );
}

/**
 * Whether each AI is signed in, checked when the app opens, when ↻ is clicked, and when John comes back to the app
 * after opening a sign-in. Sign In opens that AI's program in its own window, where he finishes in the browser.
 */
function SignIns({ overview }: { overview: AiOverview }) {
  const [signIns, setSignIns] = useState<SignIn[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [waiting, setWaiting] = useState(false);
  const check = () => {
    setChecking(true);
    getJson<SignIn[]>('/api/ai/sign-ins')
      .then((list) => {
        setSignIns(list);
        window.dispatchEvent(new Event(CHANGED));
      }, (e: Error) => setMessage(e.message))
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
      <span className="ai-signin-list">
        {signIns.map((s) => {
          const opt = overview.options.find((o) => o.id === s.id);
          const modelLabel = opt?.models.find((m) => m.id === opt.model)?.label ?? opt?.defaultLabel;
          const tip = [modelLabel && `Model: ${modelLabel}`, s.detail].filter(Boolean).join(' · ');
          return (
            <span key={s.id} className={`ai-signin ai-signin--${s.state}`} title={tip}>
              <span className="ai-signin-dot" aria-hidden="true" />
              {s.name}
              {s.state !== 'in' && (
                <button type="button" className="small" onClick={() => signIn(s)} title={s.state === 'out' ? 'Not signed in' : `Couldn't tell: ${s.detail}`}>
                  Sign In
                </button>
              )}
            </span>
          );
        })}
      </span>
      <button type="button" className="small ai-signin-check" disabled={checking} onClick={check} title="Check the sign-ins again">
        {checking ? '…' : '↻'}
      </button>
      {message && <span className="ai-signin-message">{message}</span>}
    </span>
  );
}
