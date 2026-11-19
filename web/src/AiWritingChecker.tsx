import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postJson } from './api';
import { findAiWritingTells, isProseFieldLabel } from './aiWritingCheck';
import type { AiWritingReview } from '../../server/ai-writing';

export function AiWritingChecker({ text, label }: { text: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<AiWritingReview | null>(null);
  const [error, setError] = useState('');

  if (!isProseFieldLabel(label)) return null;
  const trimmed = text.trim();
  const tells = findAiWritingTells(trimmed);

  const checkWithAi = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      setReview(await postJson<AiWritingReview>('/api/ai-writing-check', { text: trimmed, label }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!trimmed && !review && !error) return null;

  return (
    <div className="ai-writing-checker">
      <div className="ai-writing-bar">
        {tells.length > 0 ? (
          <span className="ai-writing-badge ai-writing-badge--warn">
            ⚠ {tells.length} Possible AI {tells.length === 1 ? 'Tell' : 'Tells'}
          </span>
        ) : (
          <span className="ai-writing-badge ai-writing-badge--ok">✓ No Common AI Tells</span>
        )}
        <button type="button" className="small" disabled={busy || !trimmed} onClick={() => void checkWithAi()}>
          {busy ? 'Checking for AI Writing…' : 'Check for AI Writing'}
        </button>
        {review && (
          <button type="button" className="small" onClick={() => setReview(null)}>
            Hide Review
          </button>
        )}
      </div>

      {tells.length > 0 && (
        <ul className="ai-writing-tells small-text">
          {tells.map((t, i) => (
            <li key={i}>
              <code>“{t.match}”</code> — <span className="muted">{t.reason}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="error small-text" role="alert">
          {error}
        </p>
      )}

      {review && (
        <div className="ai-writing-review">
          <div className="small-text muted" style={{ marginBottom: '0.25rem' }}>
            <strong>{review.aiName} Writing Check:</strong>
          </div>
          <div className="markdown small-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{review.review}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
