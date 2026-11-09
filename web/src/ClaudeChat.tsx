import { useEffect, useRef, useState } from 'react';
import type { ClaudeRun } from './api';
import { chosenName, useAi } from './AiPicker';

// One conversation with an AI: what's been said, what it's doing, and a box to answer in.
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
  const { overview } = useAi();
  const who = overview?.options.find((o) => o.id === (run.ai ?? 'claude'))?.name ?? 'The AI';
  const switching = !!overview && overview.chosen !== (run.ai ?? 'claude');
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
      {busy && <p className="muted small-text">{who} is working… {run.activity}</p>}
      {!busy && switching && (
        <p className="muted small-text">
          Your next note goes to {chosenName(overview)}, which takes over from {who}. It will only know what's written in
          this conversation and in the files.
        </p>
      )}
      {run.status === 'failed' && run.error && <p className="error">{run.error}</p>}
      <div className="claude-reply">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={busy ? `${who} is working…` : placeholder}
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
