import { useEffect, useRef, useState } from 'react';
import { fileUrl, formatSize, thumbUrl, type FileRef } from './api';

/** Plays the selected export in the same space as its cover. */
export function VideoPreview({ exports, covers }: { exports: FileRef[]; covers: FileRef[] }) {
  const [selected, setSelected] = useState(exports[0]?.path ?? '');
  const [playing, setPlaying] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const current = exports.find((item) => item.path === selected);
  const cover = covers[0];
  useEffect(() => { setCoverFailed(false); }, [cover?.path]);
  useEffect(() => { if (!exports.some((item) => item.path === selected)) { setSelected(exports[0]?.path ?? ''); setPlaying(false); } }, [exports, selected]);
  return <div className="video-preview">
    <div className="video-preview-frame">
      {playing && current ? <>
        <video key={current.path} ref={video} className="inline-video" src={fileUrl('projects', current.path)} controls autoPlay playsInline preload="metadata" onError={() => setError('This video could not be played in the browser.')} />
        <div className="video-preview-tools">
          {typeof document !== 'undefined' && document.pictureInPictureEnabled && <button type="button" onClick={() => { void video.current?.requestPictureInPicture().catch(() => setError('Could not pop out this video.')); }}>Pop out</button>}
          <button type="button" onClick={() => { setPlaying(false); setError(''); }}>■ Stop</button>
        </div>
      </> : <>
        {cover && !coverFailed ? <img className="video-preview-cover" src={thumbUrl('projects', cover.path, 640)} alt={cover.name} onError={() => setCoverFailed(true)} /> : <div className="video-preview-placeholder"><span aria-hidden="true">▧</span><span>No thumbnail</span></div>}
        {current && <button type="button" className="video-preview-play" aria-label={`Play ${current.name}`} onClick={() => { setError(''); setPlaying(true); }}>▶</button>}
      </>}
    </div>
    {exports.length > 1 ? <label className="video-preview-select">Video <select value={selected} onChange={(e) => { setSelected(e.target.value); setPlaying(false); setError(''); }}>{exports.map((item) => <option key={item.path} value={item.path}>{item.name} · {formatSize(item.size)}</option>)}</select></label> : current && <div className="export-row" title={current.name}><span className="ellipsis">{current.name}</span><span className="muted">{formatSize(current.size)}</span></div>}
    {covers.length > 0 && <div className="cover-stack">{covers.map((item, i) => <a key={item.path} className="cover-extra" href={fileUrl('projects', item.path)} target="_blank" rel="noreferrer" title={`${item.name} (open full size)`}><img src={thumbUrl('projects', item.path, 240)} alt={`Open cover ${i + 1}: ${item.name}`} loading="lazy" /></a>)}</div>}
    {error && <p className="error">{error}</p>}
  </div>;
}
