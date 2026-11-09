import { useEffect, useState } from 'react';
import { getJson, postJson, type ClaudeRun } from './api';
import { chosenName, useAi } from './AiPicker';
import { ClaudeChat } from './ClaudeChat';

// "Edit with ..." on a video's page: starts the chosen AI on the longform-edit skill, shows what it says, and lets John
// send notes to the same conversation after looking at the result in CapCut.
export function ClaudeEdit({ video }: { video: string }) {
  const [run, setRun] = useState<ClaudeRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = chosenName(useAi().overview);

  const refresh = () =>
    getJson<ClaudeRun | null>(`/api/claude?video=${encodeURIComponent(video)}`).then(
      (r) => {
        setRun(r);
        setLoaded(true);
      },
      (e) => setError(e.message),
    );

  useEffect(() => {
    setRun(null);
    setLoaded(false);
    refresh();
  }, [video]);

  // While the AI works, check for news every 2 seconds.
  useEffect(() => {
    if (run?.status !== 'running') return;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [run?.status, video]);

  const act = (url: string, data: object) => {
    setError(null);
    postJson<ClaudeRun>(url, { video, ...data }).then(setRun, (e) => setError(e.message));
  };

  if (!loaded) return null;

  if (!run) {
    return (
      <div className="card claude-edit">
        <button onClick={() => act('/api/claude/start', {})}>Edit with {name}</button>
        <span className="muted small-text"> {name} edits this video's CapCut project, following the longform-edit skill.</span>
        {error && <p className="error">{error}</p>}
      </div>
    );
  }

  return (
    <div className="card claude-edit">
      <h4>AI edit · CapCut project "{run.draft}"</h4>
      <ClaudeChat
        run={run}
        placeholder="Your notes after looking in CapCut, or an answer"
        onSend={(text) => act('/api/claude/note', { text })}
        onStop={() => act('/api/claude/stop', {})}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
