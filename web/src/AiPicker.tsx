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
 * At the top of the app: each AI's sign-in and the model it uses. Which AI does a job is chosen next to each button
 * (AiChoice.tsx), not here.
 */
export function AiPicker() {
  const { overview, chooseModel } = useAi();
  const [error, setError] = useState<string | null>(null);
  if (!overview) return null;
  const pickModel = (id: AiId, model: string) => {
    setError(null);
    chooseModel(id, model).catch((err: Error) => setError(err.message));
  };
  return (
    <div className="ai-controls">
      <SignIns overview={overview} onModel={pickModel} />
      {error && <span className="error">{error}</span>}
    </div>
  );
}

/** One AI's model, as a small dropdown. */
function ModelSelect({ option, onModel }: { option: AiOverview['options'][number]; onModel: (id: AiId, model: string) => void }) {
  return (
    <select className="ai-model" value={option.model} title={`Which model ${option.name} uses`} onChange={(e) => onModel(option.id, e.target.value)}>
      <option value="">{option.defaultLabel}</option>
      {option.models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Whether each AI is signed in, checked when the app opens, when ↻ is clicked, and when John comes back to the app
 * after opening a sign-in. Sign In opens that AI's program in its own window, where he finishes in the browser.
 */
function SignIns({ overview, onModel }: { overview: AiOverview; onModel: (id: AiId, model: string) => void }) {
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
          return (
            <span key={s.id} className={`ai-signin ai-signin--${s.state}`} title={s.detail}>
              <span className="ai-signin-dot" aria-hidden="true" />
              {s.name}
              {opt && <ModelSelect option={opt} onModel={onModel} />}
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
