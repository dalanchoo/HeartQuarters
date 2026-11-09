import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, type ClaudeRun } from './api';
import { chosenName, useAi } from './AiPicker';
import { ClaudeChat } from './ClaudeChat';

// On a short's card, beside its fields: the chosen AI writes the short's YouTube metadata, in that short's conversation.
// When it finishes, `onFinished` makes the card show the new text.
export function WriteMetadata({ video, short, onFinished }: { video: string; short: string; onFinished: () => void }) {
  const [run, setRun] = useState<ClaudeRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = chosenName(useAi().overview);
  const url = `/api/shorts/metadata?video=${encodeURIComponent(video)}&short=${encodeURIComponent(short)}`;
  const wasBusy = useRef(false);
  const fail = (e: Error) => setError(e.message);
  const refresh = () => getJson<ClaudeRun | null>(url).then(setRun, fail);

  useEffect(() => {
    refresh();
  }, [url]);

  const busy = run?.status === 'running';
  useEffect(() => {
    if (wasBusy.current && !busy) onFinished();
    wasBusy.current = busy;
    if (!busy) return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [busy, url]);

  const act = (path: string, data: object) => {
    setError(null);
    postJson<ClaudeRun>(path, { video, ...data }).then(setRun, fail);
  };

  return (
    <div className="write-metadata small-text">
      <button disabled={busy} onClick={() => act('/api/shorts/metadata', { short })}>
        Write YouTube metadata
      </button>
      {!busy && <span className="muted"> {name} fills in YouTube.md. You don't need to export first.</span>}
      {error && <p className="error">{error}</p>}
      {run && run.job && (
        <details className="shorts-talk" open={busy || undefined}>
          <summary>Talk to the AI about this short</summary>
          <ClaudeChat
            run={run}
            placeholder="What to change"
            onSend={(text) => act('/api/shorts/note', { job: run.job, text })}
            onStop={() => act('/api/shorts/stop', { job: run.job })}
          />
        </details>
      )}
    </div>
  );
}
