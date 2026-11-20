import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { formatSize, getJson, openInExplorer, postJson } from './api';
import type { GeneratedVideo } from '../../server/expression-videos';

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00.00';
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2).padStart(5, '0');
  return `${m}:${s}`;
}

async function uploadVideoFile(file: File): Promise<GeneratedVideo> {
  const res = await fetch(`/api/expressions/videos/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      'X-HeartQuarters': '1',
      'Content-Type': 'application/octet-stream',
    },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & Partial<GeneratedVideo>;
  if (!res.ok) throw new Error(body.error || res.statusText || 'Upload failed.');
  return body as GeneratedVideo;
}

export function ExpressionVideos({ active }: { active: boolean }) {
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [selected, setSelected] = useState('');
  const [fps, setFps] = useState(24);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = async (selectName?: string) => {
    try {
      const list = await getJson<GeneratedVideo[]>('/api/expressions/videos');
      setVideos(list);
      setSelected((cur) => {
        if (selectName && list.some((v) => v.name === selectName)) return selectName;
        if (cur && list.some((v) => v.name === cur)) return cur;
        return list[0]?.name ?? '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (active) void load();
  }, [active]);

  const current = videos.find((v) => v.name === selected) ?? null;

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      let last = '';
      for (const file of files) {
        const saved = await uploadVideoFile(file);
        last = saved.name;
      }
      await load(last);
      setStatus(`${files.length} ${files.length === 1 ? 'video added' : 'videos added'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (video: GeneratedVideo) => {
    const stem = video.name.replace(/\.[^.]+$/, '');
    const next = window.prompt('New video name:', stem);
    if (!next || next.trim() === stem) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const renamed = await postJson<GeneratedVideo>('/api/expressions/videos/rename', { name: video.name, newName: next });
      await load(renamed.name);
      setStatus(`Renamed to ${renamed.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const trash = async (video: GeneratedVideo) => {
    if (!window.confirm(`Move "${video.name}" to HeartQuarters Trash?`)) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await postJson('/api/expressions/videos/trash', { name: video.name });
      await load();
      setStatus(`Moved "${video.name}" to HeartQuarters Trash.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const step = (deltaSeconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    const max = Number.isFinite(el.duration) ? el.duration : Number.MAX_SAFE_INTEGER;
    const next = Math.max(0, Math.min(max, el.currentTime + deltaSeconds));
    el.currentTime = next;
    setCurrentTime(next);
  };

  const saveSnapshot = async () => {
    const el = videoRef.current;
    if (!el || !current || !el.videoWidth || !el.videoHeight) return;
    el.pause();
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not capture frame.');
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      const data = dataUrl.split(',')[1] ?? '';
      const stem = current.name.replace(/\.[^.]+$/, '');
      const stamp = el.currentTime.toFixed(2).replace('.', '_');
      const res = await postJson<{ path: string }>('/api/expressions/inbox/import', {
        name: `${stem} - ${stamp}s.png`,
        data,
        ai: true,
        motion: true,
      });
      window.dispatchEvent(new Event('hq-expression-inbox-changed'));
      setStatus(`Saved snapshot to Inbox as AI: ${res.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPlayerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1 / fps);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1 / fps);
    }
  };

  return (
    <details className="yt-section" open>
      <summary>Generated Videos &amp; Frame Snapshots ({videos.length})</summary>
      <p className="muted small-text">
        Drop AI-generated expression videos here, step frame-by-frame to find crisp expressions, and save snapshots straight into your Expression Inbox (marked as AI).
      </p>

      <div
        className="expression-inbox-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) void upload([...e.dataTransfer.files]);
        }}
      >
        <label>
          Choose Videos{' '}
          <input
            type="file"
            multiple
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            disabled={busy}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void upload(files);
            }}
          />
        </label>
        <span> or drop MP4, MOV, or WebM videos here. </span>
        <button
          type="button"
          className="small"
          disabled={busy}
          onClick={() => void postJson('/api/expressions/videos/open').then(() => openInExplorer('expressions', '_GeneratedVideos'))}
        >
          Open Videos Folder
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status" className="small-text">{status}</p>}

      {videos.length === 0 ? (
        <p className="muted small-text" style={{ marginTop: '0.5rem' }}>No generated videos yet.</p>
      ) : (
        <div className="generated-videos-layout">
          <div className="generated-videos-list">
            {videos.map((v) => (
              <div key={v.name} className={`generated-video-item${v.name === current?.name ? ' active' : ''}`}>
                <button
                  type="button"
                  className="generated-video-pick"
                  onClick={() => {
                    setSelected(v.name);
                    setCurrentTime(0);
                    setDuration(0);
                  }}
                >
                  <span className="generated-video-name">{v.name}</span>
                  <span className="muted small-text">{formatSize(v.size)}</span>
                </button>
                <div className="generated-video-actions">
                  <button type="button" className="small" disabled={busy} onClick={() => void rename(v)}>
                    Rename
                  </button>
                  <button type="button" className="small danger-outline" disabled={busy} onClick={() => void trash(v)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {current && (
            <div className="generated-video-player" tabIndex={0} onKeyDown={onPlayerKeyDown}>
              <video
                key={current.name}
                ref={videoRef}
                className="player"
                controls
                preload="metadata"
                src={`/api/expressions/videos/file?name=${encodeURIComponent(current.name)}&t=${current.modified}`}
                onLoadedMetadata={(e) => {
                  setDuration(e.currentTarget.duration || 0);
                  setCurrentTime(e.currentTarget.currentTime || 0);
                }}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
              />
              <div className="generated-video-controls">
                <button type="button" className="small" onClick={() => step(-1)}>
                  ⏮ -1s
                </button>
                <button type="button" className="small" onClick={() => step(-1 / fps)} title="Previous frame (Left Arrow)">
                  ◀ -1 Frame
                </button>
                <button type="button" className="small" onClick={() => step(1 / fps)} title="Next frame (Right Arrow)">
                  ▶ +1 Frame
                </button>
                <button type="button" className="small" onClick={() => step(1)}>
                  +1s ⏭
                </button>
                <label className="small-text">
                  FPS{' '}
                  <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                    <option value={24}>24</option>
                    <option value={30}>30</option>
                    <option value={60}>60</option>
                  </select>
                </label>
                <span className="muted small-text">
                  {formatTime(currentTime)} / {formatTime(duration)} · Frame {Math.round(currentTime * fps)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  style={{ marginLeft: 'auto' }}
                  onClick={() => void saveSnapshot()}
                >
                  Save Snapshot to Inbox
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
