import { useEffect, useState } from 'react';
import { getJson, postJson, type AiId, type AiOverview } from './api';

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
  );
}
