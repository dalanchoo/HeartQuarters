import { useRef, useState } from 'react';
import { fileUrl, postJson, type ExpressionPhoto } from './api';
import { isAiExpression } from '../../server/expression-origin';
import type { Point } from './portrait-outline';
import { subjectBounds } from './portrait-segmentation';

export function PortraitOutlineEditor({ photo, onClose, onSaved }: { photo: ExpressionPhoto; onClose: () => void; onSaved: () => void }) {
  const image = useRef<HTMLImageElement>(null), drawing = useRef(false), latest = useRef<Point[]>([]), cutout = useRef<HTMLCanvasElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]), [preview, setPreview] = useState('');
  const [background, setBackground] = useState('#d6d6d6');
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const point = (e: React.PointerEvent<SVGSVGElement>): Point => { const rect = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) }; };
  const add = (p: Point) => { latest.current = [...latest.current, p]; setPoints(latest.current); };
  const reset = () => { latest.current = []; setPoints([]); setPreview(''); setError(''); };
  const makePreview = async () => {
    setBusy(true); setError('');
    try {
      const img = image.current;
      if (!img?.naturalWidth) throw new Error('The photo is still loading.');
      if (!cutout.current) {
        setStatus('Loading subject selection. The first use downloads a model of about 80 MB. Your photo stays on this computer.');
        const response = await fetch(fileUrl('expressions', photo.path, photo.revision));
        if (!response.ok) throw new Error('Could not load the photo.');
        const source = await response.blob();
        const { removeBackground } = await import('@imgly/background-removal');
        const foreground = await removeBackground(source, { progress: (_key, current, total) => { if (total > 0) setStatus(`Loading subject selection: ${Math.min(100, Math.round(current / total * 100))}%.`); } });
        setStatus('Preparing the preview…');
        const bitmap = await createImageBitmap(foreground);
        try {
          const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Could not prepare the image.');
          // The model supplies the mask; the visible pixels come from the original.
          ctx.drawImage(img, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); ctx.globalCompositeOperation = 'source-over';
          cutout.current = canvas;
        } finally { bitmap.close(); }
      }
      const masked = document.createElement('canvas'); masked.width = img.naturalWidth; masked.height = img.naturalHeight;
      const ctx = masked.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Could not prepare the image.');
      if (points.length >= 3) { ctx.beginPath(); points.forEach((p, i) => { const x = p.x * masked.width, y = p.y * masked.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.clip(); }
      ctx.drawImage(cutout.current, 0, 0);
      const bounds = subjectBounds(ctx.getImageData(0, 0, masked.width, masked.height).data, masked.width, masked.height);
      const result = document.createElement('canvas'); result.width = bounds.width; result.height = bounds.height;
      const output = result.getContext('2d'); if (!output) throw new Error('Could not create the preview.');
      output.fillStyle = background; output.fillRect(0, 0, result.width, result.height); output.drawImage(masked, -bounds.x, -bounds.y);
      setPreview(result.toDataURL('image/png'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setStatus(''); }
  };
  const save = async () => { setBusy(true); setError(''); try { await postJson('/api/expressions/inbox/import', { name: `${photo.name} - Cutout.png`, data: preview.split(',')[1], ai: isAiExpression(photo) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section className="portrait-editor"><h3>Select and Crop: {photo.name}</h3>
    <p>Click Select Subject to find the person automatically. If it includes other things, draw a loose outline around yourself first; the selection will be limited to that area. No image is generated.</p>
    <div className="portrait-editor-image"><img ref={image} src={fileUrl('expressions', photo.path, photo.revision)} alt="Draw around the portrait" draggable={false} /><svg aria-label="Draw an optional rough outline" viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={e => { if (busy) return; e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); latest.current = []; setPreview(''); add(point(e)); }} onPointerMove={e => { if (drawing.current) add(point(e)); }} onPointerUp={e => { if (drawing.current) { add(point(e)); drawing.current = false; } }} onPointerCancel={() => { drawing.current = false; }}><polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffed36" strokeWidth="0.004" vectorEffect="non-scaling-stroke" style={{strokeWidth: 3}} /></svg></div>
    <p><label>Background Color <input type="color" value={background} onChange={e => { setBackground(e.target.value); setPreview(''); }} /></label>{' '}<button onClick={() => void makePreview()} disabled={busy}>Select Subject and Preview</button>{' '}<button onClick={reset} disabled={busy}>Clear Outline</button>{' '}<button onClick={onClose} disabled={busy}>Close Editor</button></p>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    {preview && <div><h4>Preview</h4><p>Check the edges, especially hair and shoulders, before saving.</p><img className="portrait-editor-preview" src={preview} alt="Preview of cropped portrait" /><p><button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Copy to Inbox'}</button></p></div>}
  </section>;
}
