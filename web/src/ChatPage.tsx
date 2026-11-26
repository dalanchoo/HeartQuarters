import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText, formatSize, getJson, postJson, type AiId } from './api';
import { useAi } from './AiPicker';
import type { ChatMessage, ChatThread, UploadedChatFile } from '../../server/chat';

const CHAT_AIS: { id: AiId; label: string }[] = [
  { id: 'claude', label: 'Send to Claude' },
  { id: 'codex', label: 'Send to ChatGPT' },
  { id: 'gemini', label: 'Send to Gemini' },
];

const SPEAKER_NAMES: Record<ChatMessage['from'], string> = {
  john: 'John',
  claude: 'Claude',
  codex: 'ChatGPT',
  gemini: 'Gemini',
};

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files?.length) return Array.from(data.files);
  return Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((f): f is File => f !== null);
}

function chatFileUrl(name: string): string {
  return `/api/chat/file?name=${encodeURIComponent(name)}`;
}

async function uploadFile(file: File): Promise<UploadedChatFile> {
  const name = file.name || 'Pasted File';
  const res = await fetch(`/api/chat/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'X-HeartQuarters': '1', 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as UploadedChatFile & { error?: string };
  if (!res.ok) throw new Error(body.error || res.statusText || 'Could not upload file.');
  return body;
}

export function ChatPage() {
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [asking, setAsking] = useState<AiId | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { overview } = useAi();
  const listRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingFile[]>([]);
  pendingRef.current = pending;

  useEffect(() => {
    let active = true;
    getJson<ChatThread>('/api/chat').then(
      (data) => { if (active) setThread(data); },
      (e: Error) => { if (active) setError(e.message); },
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => {
      for (const item of pendingRef.current) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  const stageFiles = (files: File[]) => {
    if (!files.length) return;
    setError(null);
    const added: PendingFile[] = files.map((file, idx) => {
      const isImage = file.type.startsWith('image/') || IMAGE_RE.test(file.name);
      const namedFile = file.name ? file : new File([file], `Pasted Image ${Date.now()}-${idx + 1}.png`, { type: file.type || 'image/png' });
      return {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
        file: namedFile,
        previewUrl: isImage ? URL.createObjectURL(namedFile) : null,
      };
    });
    setPending((prev) => [...prev, ...added]);
  };

  const removePending = (id: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (asking) return;
    stageFiles(Array.from(e.dataTransfer.files));
  };

  const handlePaste = (e: ClipboardEvent<HTMLElement>) => {
    const files = filesFromClipboard(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    if (!asking) stageFiles(files);
  };

  const sendTo = async (ai: AiId) => {
    if (asking) return;
    const text = draft.trim();
    if (!text && !pending.length) return;
    setAsking(ai);
    setError(null);
    try {
      const uploadedNames: string[] = [];
      for (const item of pending) {
        const res = await uploadFile(item.file);
        uploadedNames.push(res.name);
      }
      const updated = await postJson<ChatThread>('/api/chat/send', {
        ai,
        message: draft,
        files: uploadedNames,
      });
      setThread(updated);
      setDraft('');
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
      void getJson<ChatThread>('/api/chat').then(setThread, () => {});
    } finally {
      setAsking(null);
    }
  };

  const clear = async () => {
    if (!thread?.messages.length && !pending.length) return;
    if (thread?.messages.length && !window.confirm('Clear this chat conversation and move its attached files to Trash?')) return;
    setError(null);
    try {
      const cleared = await postJson<ChatThread>('/api/chat/clear');
      setThread(cleared);
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const messages = thread?.messages ?? [];

  return (
    <div
      className="chat-page"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div className={`card chat-card${dragging ? ' dragging' : ''}`}>
        <div className="chat-head">
          <div>
            <h1>Chat</h1>
            <p className="muted small-text chat-subtitle">
              Saved in Drive. Claude, ChatGPT, and Gemini all share this conversation and every attached file.
            </p>
          </div>
          <div className="chat-head-actions">
            <button
              type="button"
              className="small"
              disabled={!!asking || (!messages.length && !pending.length)}
              onClick={() => void clear()}
            >
              Clear
            </button>
          </div>
        </div>

        {error && <p className="error chat-error">{error}</p>}

        <div className="chat-messages" ref={listRef}>
          {thread === null && !error && <p className="muted small-text">Loading conversation…</p>}
          {thread !== null && messages.length === 0 && (
            <p className="muted small-text">
              No messages yet. Paste any amount of text, drop or paste any file (Word docs, PDFs, images, text), and send to any AI.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`brainstorm-msg brainstorm-msg--${m.from}`}>
              <div className="brainstorm-msg-head">
                <strong>{SPEAKER_NAMES[m.from]}</strong>
                <span className="muted small-text">
                  {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {m.from !== 'john' && (
                  <button
                    type="button"
                    className="small brainstorm-add-note"
                    onClick={() => {
                      void copyText(m.text).then((ok) => {
                        if (ok) {
                          setCopiedId(m.id);
                          setTimeout(() => setCopiedId((cur) => (cur === m.id ? null : cur)), 1500);
                        }
                      });
                    }}
                  >
                    {copiedId === m.id ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {m.files && m.files.length > 0 && (() => {
                // Skip showing a duplicate image card if the AI's Markdown already embeds that exact /api/chat/file image inline.
                const extraFiles = m.files.filter((name) => !IMAGE_RE.test(name) || !m.text.includes(chatFileUrl(name)));
                if (!extraFiles.length) return null;
                return (
                  <div className="chat-msg-files">
                    {extraFiles.map((name) => (
                      IMAGE_RE.test(name) ? (
                        <a
                          key={name}
                          href={chatFileUrl(name)}
                          target="_blank"
                          rel="noreferrer"
                          className="chat-image-card"
                          title={`Open ${name}`}
                        >
                          <img src={chatFileUrl(name)} alt={name} className="chat-msg-image" />
                          <span className="muted small-text">{name}</span>
                        </a>
                      ) : (
                        <a
                          key={name}
                          href={chatFileUrl(name)}
                          target="_blank"
                          rel="noreferrer"
                          className="chat-file-chip"
                        >
                          <span>{name}</span>
                        </a>
                      )
                    ))}
                  </div>
                );
              })()}
              {m.from === 'john'
                ? <div className="brainstorm-msg-text">{m.text}</div>
                : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>}
            </div>
          ))}
        </div>

        {asking && <p className="muted small-text chat-status">Asking {SPEAKER_NAMES[asking]}…</p>}
        {dragging && <div className="chat-drop-banner">Drop files here to attach…</div>}

        <div className="chat-compose">
          {pending.length > 0 && (
            <div className="chat-pending-files">
              {pending.map((item) => (
                <div key={item.id} className="chat-pending-chip">
                  {item.previewUrl && <img src={item.previewUrl} alt={item.file.name} className="chat-file-thumb" />}
                  <span>{item.file.name}</span>
                  <span className="muted small-text">({formatSize(item.file.size)})</span>
                  <button
                    type="button"
                    className="small"
                    disabled={!!asking}
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removePending(item.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            rows={4}
            value={draft}
            disabled={!!asking}
            placeholder="Paste or type anything (no length limit), or drop/paste any file (Word, PDF, image, etc.)…"
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="chat-compose-actions">
            <div className="brainstorm-send-buttons">
              {CHAT_AIS.map(({ id, label }) => {
                const opt = overview?.options.find((o) => o.id === id);
                const available = opt ? opt.available : true;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!!asking || (!draft.trim() && !pending.length) || !available}
                    title={!available ? `${SPEAKER_NAMES[id]} is not installed` : undefined}
                    onClick={() => void sendTo(id)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="chat-attach-actions">
              <input
                ref={pickerRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length) stageFiles(files);
                }}
              />
              <button type="button" disabled={!!asking} onClick={() => pickerRef.current?.click()}>
                Attach File
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
