import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { copyText, filesFromClipboard, formatSize, getJson, insertTextAtCursor, postFile, postJson, replaceHash, type AiId } from './api';
import { AI_OPTIONS, aiName } from './AiChoice';
import { useAi } from './AiPicker';
import { SidebarResizer } from './SidebarResizer';
import { clampComposeHeight, COMPOSE_DEFAULT_HEIGHT, COMPOSE_MAX_HEIGHT, COMPOSE_MIN_HEIGHT, loadComposeHeight, saveComposeHeight } from './chatComposeResize';
import type { ChatIndex, ChatMessage, ChatSummary, ChatThread, UploadedChatFile, VideoPart } from '../../server/chat';
import type { VideoIdea } from '../../server/video-ideas';

const speakerName = (from: ChatMessage['from']) => (from === 'john' ? 'John' : aiName(from));

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v|mkv)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|ogg|aac)$/i;
const SIDEBAR_KEY = 'hq-chat-sidebar-open';

type PendingItem =
  | { id: string; kind: 'local'; name: string; size: number; file: File; previewUrl: string | null }
  | { id: string; kind: 'uploaded'; name: string; size: number; previewUrl: null };

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
  return postFile<UploadedChatFile>(`/api/chat/upload?name=${encodeURIComponent(name)}`, file);
}

function SidebarToggleIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" className="chat-sidebar-icon">
      <rect x="2" y="3" width="14" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {open
        ? <rect x="2" y="3" width="5" height="12" rx="2" fill="currentColor" />
        : <line x1="6" y1="6" x2="6" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
    </svg>
  );
}

function InsertArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" className="chat-sidebar-icon">
      <path d="M3 8h9M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChatPage() {
  const [index, setIndex] = useState<ChatIndex>({ version: 1, folders: [], chats: [] });
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(loadSidebarOpen);
  const [draft, setDraft] = useState('');
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [composeHeight, setComposeHeight] = useState<number | null>(loadComposeHeight);
  const composeDrag = useRef<{ y: number; height: number; pointerId: number } | null>(null);
  const composeHeightRef = useRef<number | null>(composeHeight);
  composeHeightRef.current = composeHeight;
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [asking, setAsking] = useState<AiId | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [linkedIdea, setLinkedIdea] = useState<VideoIdea | null>(null);
  const [videoParts, setVideoParts] = useState<Record<string, VideoPart[] | 'loading'>>({});
  const { overview } = useAi();
  const listRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingItem[]>([]);
  pendingRef.current = pending;
  const loadEpoch = useRef(0);
  const askingRef = useRef<AiId | null>(null);
  askingRef.current = asking;

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const active = composeDrag.current;
      if (active?.pointerId !== event.pointerId) return;
      setComposeHeight(clampComposeHeight(active.height + (active.y - event.clientY), window.innerHeight));
    };
    const stop = (event: PointerEvent) => {
      if (composeDrag.current?.pointerId !== event.pointerId) return;
      composeDrag.current = null;
      document.body.classList.remove('is-resizing-chat-compose');
      if (event.type === 'pointerup') saveComposeHeight(composeHeightRef.current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (composeDrag.current) document.body.classList.remove('is-resizing-chat-compose');
    };
  }, []);

  const loadAll = async (requestedId = chatIdFromHash()) => {
    const epoch = ++loadEpoch.current;
    const idx = await getJson<ChatIndex>('/api/chat/list');
    if (loadEpoch.current !== epoch) return;
    setIndex(idx);
    const idToLoad = requestedId && idx.chats.some((c) => c.id === requestedId) ? requestedId : '';
    const data = await getJson<ChatThread>(idToLoad ? `/api/chat?id=${encodeURIComponent(idToLoad)}` : '/api/chat');
    if (loadEpoch.current !== epoch) return;
    setThread(data);
    if (data.id && location.hash.startsWith('#Chat')) {
      replaceHash(`#Chat/${encodeURIComponent(data.id)}`);
    }
  };

  useEffect(() => {
    let active = true;
    loadAll().catch((e: Error) => { if (active) setError(e.message); });
    const onHash = () => {
      if (!location.hash.startsWith('#Chat') || askingRef.current) return;
      const id = chatIdFromHash();
      if (id) {
        loadAll(id).catch((e: Error) => { if (active) setError(e.message); });
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

  const updateScrollBottom = () => {
    const el = listRef.current;
    setShowScrollBottom(!!el && el.scrollHeight - el.scrollTop - el.clientHeight > 40);
  };

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowScrollBottom(false);
  }, [thread?.id, thread?.messages.length]);

  useEffect(() => {
    updateScrollBottom();
  }, [composeHeight]);

  useEffect(() => {
    const ideaId = thread?.ideaId;
    if (!ideaId) {
      setLinkedIdea(null);
      return;
    }
    let active = true;
    getJson<VideoIdea[]>('/api/ideas').then(
      (all) => { if (active) setLinkedIdea(all.find((i) => i.id === ideaId) ?? null); },
      () => { if (active) setLinkedIdea(null); },
    );
    return () => { active = false; };
  }, [thread?.ideaId]);

  const insertAtCursor = (snippet: string) => insertTextAtCursor(draftRef.current, draft, snippet, setDraft);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const selectChat = async (id: string) => {
    if (asking) return;
    const epoch = ++loadEpoch.current;
    setError(null);
    try {
      const data = await getJson<ChatThread>(`/api/chat?id=${encodeURIComponent(id)}`);
      if (loadEpoch.current !== epoch) return;
      setThread(data);
      replaceHash(`#Chat/${encodeURIComponent(id)}`);
    } catch (e) {
      if (loadEpoch.current === epoch) setError((e as Error).message);
    }
  };

  const startNewChat = async (folderId: string | null = null) => {
    if (asking) return;
    setError(null);
    try {
      const res = await postJson<{ index: ChatIndex; chat: ChatThread }>('/api/chat/new', { folderId });
      setIndex(res.index);
      setThread(res.chat);
      replaceHash(`#Chat/${encodeURIComponent(res.chat.id)}`);
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
        replaceHash('#Chat');
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
    const added: PendingItem[] = files.map((file, idx) => {
      const isImage = file.type.startsWith('image/') || IMAGE_RE.test(file.name);
      const namedFile = file.name ? file : new File([file], `Pasted Image ${Date.now()}-${idx + 1}.png`, { type: file.type || 'image/png' });
      return {
        id: `${Date.now()}-${idx}-${Math.random().toString(36).slice(2)}`,
        kind: 'local',
        name: namedFile.name,
        size: namedFile.size,
        file: namedFile,
        previewUrl: isImage ? URL.createObjectURL(namedFile) : null,
      };
    });
    setPending((prev) => [...prev, ...added]);
  };

  const insertIdeaLink = async (url: string, note: string) => {
    if (asking) return;
    setError(null);
    try {
      const res = await postJson<{ kind: 'file'; file: UploadedChatFile } | { kind: 'text'; text: string }>(
        '/api/chat/attach-link',
        { url, note },
      );
      if (res.kind === 'file') {
        setPending((prev) => [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind: 'uploaded',
            name: res.file.name,
            size: res.file.size,
            previewUrl: null,
          },
        ]);
      } else {
        insertAtCursor(res.text);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loadVideoParts = (url: string) => {
    if (videoParts[url]) return;
    setVideoParts((prev) => ({ ...prev, [url]: 'loading' }));
    getJson<VideoPart[]>(`/api/chat/video-parts?url=${encodeURIComponent(url)}`).then(
      (parts) => setVideoParts((prev) => ({ ...prev, [url]: parts })),
      (e: Error) => {
        setError(e.message);
        setVideoParts((prev) => {
          const next = { ...prev };
          delete next[url];
          return next;
        });
      },
    );
  };

  const insertVideoPart = async (relPath: string) => {
    if (asking) return;
    setError(null);
    try {
      const file = await postJson<UploadedChatFile>('/api/chat/attach-part', { relPath });
      setPending((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          kind: 'uploaded',
          name: file.name,
          size: file.size,
          previewUrl: null,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
    }
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
        if (item.kind === 'uploaded') {
          uploadedNames.push(item.name);
        } else {
          const res = await uploadFile(item.file);
          uploadedNames.push(res.name);
        }
      }
      const updated = await postJson<ChatThread>('/api/chat/send', {
        id: thread?.id || null,
        ai,
        message: draft,
        files: uploadedNames,
      });
      loadEpoch.current++;
      setThread(updated);
      setIndex(await getJson<ChatIndex>('/api/chat/list'));
      if (updated.id && location.hash.startsWith('#Chat')) replaceHash(`#Chat/${encodeURIComponent(updated.id)}`);
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
      {sidebarOpen ? (
        <>
          <aside className="sidebar chat-sidebar">
            <div className="chat-sidebar-actions">
              <button
                type="button"
                className="small chat-sidebar-toggle"
                onClick={toggleSidebar}
                aria-label="Hide Sidebar"
                title="Hide Sidebar"
              >
                <SidebarToggleIcon open />
              </button>
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

            {linkedIdea && (
              <details className="yt-section chat-idea-links" open>
                <summary>
                  <span>Idea Links</span>
                  <span className="muted small-text">{linkedIdea.references.length}</span>
                </summary>
                {linkedIdea.references.length === 0 ? (
                  <p className="muted small-text chat-empty-folder">No links on this idea.</p>
                ) : (
                  <div className="chat-idea-link-list">
                    {linkedIdea.references.map((ref) => {
                      if (ref.url.startsWith('#Videos/')) {
                        const parts = videoParts[ref.url];
                        return (
                          <details
                            key={ref.id}
                            className="chat-video-link"
                            onToggle={(e) => { if (e.currentTarget.open) loadVideoParts(ref.url); }}
                          >
                            <summary title={ref.url}>
                              <span className="ellipsis small-text">{ref.note || ref.url}</span>
                            </summary>
                            <div className="chat-video-parts">
                              {parts === 'loading' && <span className="muted small-text">Loading files…</span>}
                              {Array.isArray(parts) && parts.length === 0 && (
                                <span className="muted small-text">No files found for this video.</span>
                              )}
                              {Array.isArray(parts) && parts.map((part) => (
                                <div key={part.id} className="chat-idea-link-row">
                                  <span className="ellipsis small-text" title={`${part.label} (${formatSize(part.size)})`}>
                                    {part.label}
                                  </span>
                                  <button
                                    type="button"
                                    className="small chat-insert-btn"
                                    disabled={!!asking}
                                    aria-label={`Insert ${part.label}`}
                                    title={`Insert ${part.label}`}
                                    onClick={() => void insertVideoPart(part.relPath)}
                                  >
                                    <InsertArrowIcon />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      }
                      return (
                        <div key={ref.id} className="chat-idea-link-row">
                          <span className="ellipsis small-text" title={ref.note ? `${ref.note} (${ref.url})` : ref.url}>
                            {ref.note || ref.url}
                          </span>
                          <button
                            type="button"
                            className="small chat-insert-btn"
                            disabled={!!asking}
                            aria-label={`Insert ${ref.note || ref.url}`}
                            title={`Insert ${ref.note || ref.url}`}
                            onClick={() => void insertIdeaLink(ref.url, ref.note)}
                          >
                            <InsertArrowIcon />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </details>
            )}
          </aside>
          <SidebarResizer />
        </>
      ) : (
        <aside className="chat-sidebar-collapsed">
          <button
            type="button"
            className="small chat-sidebar-toggle"
            onClick={toggleSidebar}
            aria-label="Show Sidebar"
            title="Show Sidebar"
          >
            <SidebarToggleIcon open={false} />
          </button>
        </aside>
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
              <div className="chat-title-wrap">
                <div className="chat-title-row">
                  <h1 className="ellipsis">{thread?.title || 'Chat'}</h1>
                  {thread?.ideaId && (
                    <a href={`#Ideas/${encodeURIComponent(thread.ideaId)}`} className="chat-idea-link">
                      ← Back to Idea
                    </a>
                  )}
                </div>
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

          <div className="chat-messages-wrap">
            <div className="chat-messages" ref={listRef} onScroll={updateScrollBottom}>
            {thread === null && !error && <p className="muted small-text">Loading conversation…</p>}
            {thread !== null && messages.length === 0 && (
              <p className="muted small-text">
                No messages yet. Paste any amount of text, drop or paste any file (Word docs, PDFs, images, text), and send to any AI.
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`brainstorm-msg brainstorm-msg--${m.from}`}>
                <div className="brainstorm-msg-head">
                  <strong>{speakerName(m.from)}</strong>
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
            {showScrollBottom && (
              <button
                type="button"
                className="chat-scroll-bottom"
                aria-label="Scroll to Bottom"
                title="Scroll to Bottom"
                onClick={() => {
                  const el = listRef.current;
                  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M8 3v10M4 9l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>

          {asking && <p className="muted small-text chat-status">Asking {aiName(asking)}…</p>}
          {dragging && <div className="chat-drop-banner">Drop files here to attach…</div>}

          <div className="chat-compose">
            <div
              className="chat-compose-resizer"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize message box"
              aria-valuemin={COMPOSE_MIN_HEIGHT}
              aria-valuemax={COMPOSE_MAX_HEIGHT}
              aria-valuenow={composeHeight ?? COMPOSE_DEFAULT_HEIGHT}
              tabIndex={0}
              title="Drag to make the message box taller or shorter. Double-click for the standard size."
              onPointerDown={(e) => {
                if (e.button !== 0 || composeDrag.current) return;
                e.preventDefault();
                const startHeight = draftRef.current?.getBoundingClientRect().height ?? composeHeight ?? COMPOSE_DEFAULT_HEIGHT;
                composeDrag.current = { y: e.clientY, height: startHeight, pointerId: e.pointerId };
                e.currentTarget.setPointerCapture(e.pointerId);
                document.body.classList.add('is-resizing-chat-compose');
              }}
              onDoubleClick={() => {
                setComposeHeight(null);
                saveComposeHeight(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                const step = e.shiftKey ? 48 : 16;
                const current = draftRef.current?.getBoundingClientRect().height ?? composeHeight ?? COMPOSE_DEFAULT_HEIGHT;
                const next = clampComposeHeight(current + (e.key === 'ArrowUp' ? step : -step), window.innerHeight);
                setComposeHeight(next);
                saveComposeHeight(next);
              }}
            />
            {pending.length > 0 && (
              <div className="chat-pending-files">
                {pending.map((item) => (
                  <div key={item.id} className="chat-pending-chip">
                    {item.previewUrl && <img src={item.previewUrl} alt={item.name} className="chat-file-thumb" />}
                    <span>{item.name}</span>
                    <span className="muted small-text">({formatSize(item.size)})</span>
                    <button
                      type="button"
                      className="small"
                      disabled={!!asking}
                      aria-label={`Remove ${item.name}`}
                      onClick={() => removePending(item.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={draftRef}
              rows={4}
              style={composeHeight != null ? { height: `${composeHeight}px` } : undefined}
              value={draft}
              disabled={!!asking}
              placeholder="Paste or type anything (no length limit), or drop/paste any file (Word, PDF, image, etc.)…"
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="chat-compose-actions">
              <div className="brainstorm-send-buttons">
                {AI_OPTIONS.map(({ id, name }) => {
                  const opt = overview?.options.find((o) => o.id === id);
                  const available = opt ? opt.available : true;
                  return (
                    <button
                      key={id}
                      type="button"
                      disabled={!!asking || (!draft.trim() && !pending.length) || !available}
                      title={!available ? `${name} is not installed` : undefined}
                      onClick={() => void sendTo(id)}
                    >
                      Send to {name}
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
