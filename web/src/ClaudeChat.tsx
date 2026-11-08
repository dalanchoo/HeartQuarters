import { useEffect, useRef, useState } from 'react';
import type { ClaudeRun } from './api';

// One conversation with Claude: what's been said, what it's doing, and a box to answer in.
// Used by "Edit with Claude", the list of shorts, and each short.
export function ClaudeChat({
  run,
  placeholder,
  onSend,
  onStop,
}: {
  run: ClaudeRun;
  placeholder: string;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [note, setNote] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Scrolls the conversation only, never the page around it.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [run.messages.length]);

  const busy = run.status === 'running';
  return (
    <>
      <div className="claude-messages" ref={listRef}>
        {run.messages.map((m, i) => (
          <div key={i} className={`claude-msg ${m.from}`}>
            {m.text}
          </div>
        ))}
      </div>
      {busy && <p className="muted small-text">Working… {run.activity}</p>}
      {run.status === 'failed' && run.error && <p className="error">{run.error}</p>}
      <div className="claude-reply">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={busy ? 'Claude is working…' : placeholder}
          disabled={busy}
          rows={3}
        />
        <div className="claude-buttons">
          <button
            disabled={busy || !note.trim()}
            onClick={() => {
              onSend(note);
              setNote('');
            }}
          >
            Send
          </button>
          {busy && <button onClick={onStop}>Stop</button>}
        </div>
      </div>
    </>
  );
}
