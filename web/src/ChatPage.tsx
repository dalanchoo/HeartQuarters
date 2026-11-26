import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText, formatSize, getJson, postJson, type AiId } from './api';
import { useAi } from './AiPicker';
import { SidebarResizer } from './SidebarResizer';
import type { ChatIndex, ChatMessage, ChatSummary, ChatThread, UploadedChatFile } from '../../server/chat';

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
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|ogg|aac)$/i;
const SIDEBAR_KEY = 'hq-chat-sidebar-open';

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

function chatIdFromHash(): string {
  if (!location.hash.startsWith('#Chat/')) return '';
  try {
    return decodeURIComponent(location.hash.slice('#Chat/'.length));
  } catch {
    return '';
  }
}

function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== 'false';
  } catch {
    return true;
  }
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
  const [index, setIndex] = useState<ChatIndex>({ version: 1, folders: [], chats: [] });
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(loadSidebarOpen);
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

  const loadAll = async (requestedId = chatIdFromHash()) => {
    const idx = await getJson<ChatIndex>('/api/chat/list');
    setIndex(idx);
    const idToLoad = requestedId && idx.chats.some((c) => c.id === requestedId) ? requestedId : '';
    const data = await getJson<ChatThread>(idToLoad ? `/api/chat?id=${encodeURIComponent(idToLoad)}` : '/api/chat');
    setThread(data);
    if (data.id && location.hash.startsWith('#Chat')) {
      const targetHash = `#Chat/${encodeURIComponent(data.id)}`;
      if (location.hash !== targetHash) history.replaceState(null, '', targetHash);
    }
  };

  useEffect(() => {
    let active = true;
    loadAll().catch((e: Error) => { if (active) setError(e.message); });
    const onHash = () => {
      if (!location.hash.startsWith('#Chat')) return;
      const id = chatIdFromHash();
      if (id && id !== thread?.id) {
        getJson<ChatThread>(`/api/chat?id=${encodeURIComponent(id)}`).then(
          (data) => { if (active) setThread(data); },
          () => {},
        );
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHash);
    };
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
  }, [thread?.id, thread?.messages.length]);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const selectChat = async (id: string) => {
    if (asking) return;
    setError(null);
    try {
      const data = await getJson<ChatThread>(`/api/chat?id=${encodeURIComponent(id)}`);
      setThread(data);
      history.replaceState(null, '', `#Chat/${encodeURIComponent(id)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const startNewChat = async (folderId: string | null = null) => {
    if (asking) return;
    setError(null);
    try {
      const res = await postJson<{ index: ChatIndex; chat: ChatThread }>('/api/chat/new', { folderId });
      setIndex(res.index);
      setThread(res.chat);
      history.replaceState(null, '', `#Chat/${encodeURIComponent(res.chat.id)}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renameCurrentChat = async () => {
    if (!thread?.id || asking) return;
    const next = window.prompt('Conversation Name', thread.title);
    if (next === null || !next.trim()) return;
    setError(null);
    try {
      const idx = await postJson<ChatIndex>('/api/chat/rename', { id: thread.id, title: next.trim() });
      setIndex(idx);
      setThread((cur) => (cur ? { ...cur, title: next.trim() } : cur));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const moveCurrentChat = async (folderId: string) => {
    if (!thread?.id || asking) return;
    setError(null);
    try {
      const target = folderId || null;
      const idx = await postJson<ChatIndex>('/api/chat/move', { id: thread.id, folderId: target });
      setIndex(idx);
      setThread((cur) => (cur ? { ...cur, folderId: target } : cur));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteCurrentChat = async () => {
    if (!thread?.id || asking) return;
    if (!window.confirm(`Delete “${thread.title}” and move its files to Trash?`)) return;
    setError(null);
    try {
      const idx = await postJson<ChatIndex>('/api/chat/delete', { id: thread.id });
      setIndex(idx);
      const next = idx.chats[0];
      if (next) {
        await selectChat(next.id);
      } else {
        setThread({ version: 1, id: '', title: 'New Chat', folderId: null, messages: [] });
        history.replaceState(null, '', '#Chat');
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addFolder = async () => {
    const name = window.prompt('New Folder Name');
    if (name === null || !name.trim()) return;
    setError(null);
    try {
      setIndex(await postJson<ChatIndex>('/api/chat/folder/add', { name: name.trim() }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const renameOneFolder = async (folderId: string, currentName: string) => {
    const name = window.prompt('Rename Folder', currentName);
    if (name === null || !name.trim()) return;
    setError(null);
    try {
      setIndex(await postJson<ChatIndex>('/api/chat/folder/rename', { id: folderId, name: name.trim() }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteOneFolder = async (folderId: string, currentName: string) => {
    if (!window.confirm(`Delete folder “${currentName}”? Conversations inside will be moved out of the folder.`)) return;
    setError(null);
    try {
      const idx = await postJson<ChatIndex>('/api/chat/folder/delete', { id: folderId });
      setIndex(idx);
      setThread((cur) => (cur && cur.folderId === folderId ? { ...cur, folderId: null } : cur));
    } catch (e) {
      setError((e as Error).message);
    }
  };

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
        id: thread?.id || null,
        ai,
        message: draft,
        files: uploadedNames,
      });
      setThread(updated);
      setIndex(await getJson<ChatIndex>('/api/chat/list'));
      if (updated.id) history.replaceState(null, '', `#Chat/${encodeURIComponent(updated.id)}`);
      setDraft('');
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
      if (thread?.id) {
        void getJson<ChatThread>(`/api/chat?id=${encodeURIComponent(thread.id)}`).then(setThread, () => {});
      }
    } finally {
      setAsking(null);
    }
  };

  const clear = async () => {
    if (!thread?.id || (!thread.messages.length && !pending.length)) return;
    if (thread.messages.length && !window.confirm(`Clear messages in “${thread.title}” and move its files to Trash?`)) return;
    setError(null);
    try {
      const cleared = await postJson<ChatThread>('/api/chat/clear', { id: thread.id });
      setThread(cleared);
      setIndex(await getJson<ChatIndex>('/api/chat/list'));
      for (const item of pending) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const messages = thread?.messages ?? [];
  const unfiledChats = index.chats.filter((c) => !c.folderId || !index.folders.some((f) => f.id === c.folderId));

  const renderChatButton = (c: ChatSummary) => {
    const active = thread?.id === c.id;
    return (
      <button
        key={c.id}
        type="button"
        className={`chat-nav-item${active ? ' active' : ''}`}
        disabled={!!asking}
        onClick={() => void selectChat(c.id)}
        title={c.title}
      >
        <span className="ellipsis">{c.title}</span>
        {c.messageCount > 0 && <span className="muted small-text">{c.messageCount}</span>}
      </button>
    );
  };

  return (
    <div className="split chat-split">
      {sidebarOpen && (
        <>
          <aside className="sidebar chat-sidebar">
            <div className="chat-sidebar-actions">
              <button type="button" className="small" disabled={!!asking} onClick={() => void startNewChat(null)}>
                New Chat
              </button>
              <button type="button" className="small" disabled={!!asking} onClick={() => void addFolder()}>
                New Folder
              </button>
            </div>

            {index.folders.map((folder) => {
              const folderChats = index.chats.filter((c) => c.folderId === folder.id);
              return (
                <details key={folder.id} className="yt-section chat-folder" open>
                  <summary>
                    <span className="ellipsis">{folder.name}</span>
                    <span className="muted small-text">{folderChats.length}</span>
                  </summary>
                  <div className="chat-folder-tools">
                    <button type="button" className="small" disabled={!!asking} onClick={() => void startNewChat(folder.id)}>
                      New
                    </button>
                    <button type="button" className="small" disabled={!!asking} onClick={() => void renameOneFolder(folder.id, folder.name)}>
                      Rename
                    </button>
                    <button type="button" className="small" disabled={!!asking} onClick={() => void deleteOneFolder(folder.id, folder.name)}>
                      Delete
                    </button>
                  </div>
                  <div className="chat-nav-list">
                    {folderChats.length === 0
                      ? <p className="muted small-text chat-empty-folder">Empty</p>
                      : folderChats.map(renderChatButton)}
                  </div>
                </details>
              );
            })}

            <div className="chat-nav-list">
              {unfiledChats.map(renderChatButton)}
              {index.chats.length === 0 && index.folders.length === 0 && (
                <p className="muted small-text chat-empty-folder">No conversations yet.</p>
              )}
            </div>
          </aside>
          <SidebarResizer />
        </>
      )}

      <div
        className="chat-page"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <div className={`card chat-card${dragging ? ' dragging' : ''}`}>
          <div className="chat-head">
            <div className="chat-head-left">
              <button type="button" className="small" onClick={toggleSidebar}>
                {sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
              </button>
              <div className="chat-title-wrap">
                <h1 className="ellipsis">{thread?.title || 'Chat'}</h1>
                <p className="muted small-text chat-subtitle">
                  Saved in Drive. Claude, ChatGPT, and Gemini all share this conversation and every attached file.
                </p>
              </div>
            </div>
            <div className="chat-head-actions">
              {thread?.id && (
                <>
                  <select
                    aria-label="Folder"
                    disabled={!!asking}
                    value={thread.folderId ?? ''}
                    onChange={(e) => void moveCurrentChat(e.target.value)}
                  >
                    <option value="">No Folder</option>
                    {index.folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <button type="button" className="small" disabled={!!asking} onClick={() => void renameCurrentChat()}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="small"
                    disabled={!!asking || (!messages.length && !pending.length)}
                    onClick={() => void clear()}
                  >
                    Clear
                  </button>
                  <button type="button" className="small" disabled={!!asking} onClick={() => void deleteCurrentChat()}>
                    Delete
                  </button>
                </>
              )}
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
                        ) : VIDEO_RE.test(name) ? (
                          <div key={name} className="chat-media-card">
                            <video controls preload="metadata" src={chatFileUrl(name)} className="chat-msg-video" />
                            <a href={chatFileUrl(name)} target="_blank" rel="noreferrer" className="muted small-text">
                              {name}
                            </a>
                          </div>
                        ) : AUDIO_RE.test(name) ? (
                          <div key={name} className="chat-media-card">
                            <audio controls preload="metadata" src={chatFileUrl(name)} />
                            <a href={chatFileUrl(name)} target="_blank" rel="noreferrer" className="muted small-text">
                              {name}
                            </a>
                          </div>
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
    </div>
  );
}
