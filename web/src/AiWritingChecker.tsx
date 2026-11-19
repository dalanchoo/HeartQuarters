import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postJson } from './api';
import { findAiTellSpans, findAiWritingTells, isProseFieldLabel, type AiTellSpan } from './aiWritingCheck';
import type { AiWritingReview } from '../../server/ai-writing';

/**
 * Renders `text` (which starts at `offset` within the full string) with `<span className="ai-tell-mark">`
 * around any character range covered by `spans`, including hover tooltips explaining why it was flagged.
 */
export function renderTextWithAiTells(text: string, spans = findAiTellSpans(text), offset = 0): ReactNode {
  if (!text || spans.length === 0) return text;
  const start = offset;
  const end = offset + text.length;
  const overlapping = spans.filter((s) => s.end > start && s.start < end);
  if (overlapping.length === 0) return text;

  const points = new Set<number>([start, end]);
  for (const s of overlapping) {
    if (s.start > start && s.start < end) points.add(s.start);
    if (s.end > start && s.end < end) points.add(s.end);
  }
  const sorted = [...points].sort((a, b) => a - b);

  return sorted.slice(0, -1).map((a, i) => {
    const b = sorted[i + 1];
    const slice = text.slice(a - start, b - start);
    const active = overlapping.filter((s) => s.start <= a && s.end >= b);
    if (active.length === 0) return slice;
    const reasons = [...new Set(active.map((s) => s.reason))];
    const tooltip = `⚠ AI Tell: ${reasons.join(' • ')}`;
    return (
      <span key={a} className="ai-tell-mark" data-ai-tell={tooltip}>
        {slice}
      </span>
    );
  });
}

export function AiHighlightedText({ text }: { text: string }) {
  return <>{renderTextWithAiTells(text)}</>;
}

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
