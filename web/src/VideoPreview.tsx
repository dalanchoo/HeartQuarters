import { useEffect, useRef, useState } from 'react';
import { fileStamp, fileUrl, formatSize, thumbUrl, type FileRef } from './api';

/** Plays the selected export in the same space as its cover. */
export function VideoPreview({ exports, covers, poster }: { exports: FileRef[]; covers: FileRef[]; poster?: { src: string; alt: string } }) {
  const [selected, setSelected] = useState(exports[0]?.path ?? '');
  const [playing, setPlaying] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const current = exports.find((item) => item.path === selected);
  const cover = covers[0];
  const coverSrc = cover ? thumbUrl('projects', cover.path, 640, fileStamp(cover)) : poster?.src;
  const thumbnail = coverSrc && !coverFailed
    ? <img className="video-preview-cover" src={coverSrc} alt={cover?.name ?? poster?.alt ?? ''} onError={() => setCoverFailed(true)} />
    : <span className="video-preview-placeholder"><span aria-hidden="true">▧</span><span>No thumbnail</span></span>;
  useEffect(() => { setCoverFailed(false); }, [coverSrc]);
  useEffect(() => { if (!exports.some((item) => item.path === selected)) { setSelected(exports[0]?.path ?? ''); setPlaying(false); } }, [exports, selected]);
  return <div className="video-preview">
    <div className="video-preview-frame">
      {playing && current ? <>
        <video key={current.path} ref={video} className="inline-video" src={fileUrl('projects', current.path)} controls autoPlay playsInline preload="metadata" onError={() => setError('This video could not be played in the browser.')} />
        <div className="video-preview-tools">
          {typeof document !== 'undefined' && document.pictureInPictureEnabled && <button type="button" onClick={() => { void video.current?.requestPictureInPicture().catch(() => setError('Could not pop out this video.')); }}>Pop Out</button>}
          <button type="button" onClick={() => { setPlaying(false); setError(''); }}>■ Stop</button>
        </div>
      </> : current ? (
        <button type="button" className="video-preview-play" aria-label={`Play ${current.name}`} onClick={() => { setError(''); setPlaying(true); }}>
          {thumbnail}<span className="video-preview-play-icon" aria-hidden="true">▶</span>
        </button>
      ) : thumbnail}
    </div>
    {exports.length > 1 ? <label className="video-preview-select">Video <select value={selected} onChange={(e) => { setSelected(e.target.value); setPlaying(false); setError(''); }}>{exports.map((item) => <option key={item.path} value={item.path}>{item.name} · {formatSize(item.size)}</option>)}</select></label> : current && <div className="export-row" title={current.name}><span className="ellipsis">{current.name}</span><span className="muted">{formatSize(current.size)}</span></div>}
    {covers.length > 0 && <div className="cover-stack">{covers.map((item, i) => <a key={`${item.path}-${fileStamp(item)}`} className="cover-extra" href={fileUrl('projects', item.path, fileStamp(item))} target="_blank" rel="noreferrer" title={`${item.name} (open full size)`}><img src={thumbUrl('projects', item.path, 240, fileStamp(item))} alt={`Open cover ${i + 1}: ${item.name}`} loading="lazy" /></a>)}</div>}
    {error && <p className="error">{error}</p>}
  </div>;
}
