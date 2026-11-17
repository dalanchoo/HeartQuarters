import { useRef, useState } from 'react';
import { fileUrl, postJson, type ExpressionPhoto } from './api';
import { isAiExpression } from '../../server/expression-origin';
import { outlineBounds, type Point } from './portrait-outline';

export function PortraitOutlineEditor({ photo, onClose, onSaved }: { photo: ExpressionPhoto; onClose: () => void; onSaved: () => void }) {
  const image = useRef<HTMLImageElement>(null), drawing = useRef(false), latest = useRef<Point[]>([]);
  const [points, setPoints] = useState<Point[]>([]), [preview, setPreview] = useState('');
  const [background, setBackground] = useState('#d6d6d6');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const point = (e: React.PointerEvent<SVGSVGElement>): Point => { const rect = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) }; };
  const add = (p: Point) => { latest.current = [...latest.current, p]; setPoints(latest.current); };
  const reset = () => { latest.current = []; setPoints([]); setPreview(''); setError(''); };
  const makePreview = () => {
    try {
      const img = image.current;
      if (!img?.naturalWidth) throw new Error('The photo is still loading.');
      const bounds = outlineBounds(points, img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas'); canvas.width = bounds.width; canvas.height = bounds.height;
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('The browser could not create the edited photo.');
      ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save(); ctx.beginPath(); points.forEach((p, i) => { const x = p.x * img.naturalWidth - bounds.x, y = p.y * img.naturalHeight - bounds.y; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath(); ctx.clip(); ctx.drawImage(img, -bounds.x, -bounds.y); ctx.restore();
      setPreview(canvas.toDataURL('image/png')); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const save = async () => { setBusy(true); setError(''); try { await postJson('/api/expressions/inbox/import', { name: `${photo.name} - Cutout.png`, data: preview.split(',')[1], ai: isAiExpression(photo) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section className="portrait-editor"><h3>Outline and Crop: {photo.name}</h3>
    <p>Draw a continuous outline around yourself. The area outside it becomes the background. The result is cropped around your outline; nothing is generated.</p>
    <div className="portrait-editor-image"><img ref={image} src={fileUrl('expressions', photo.path, photo.revision)} alt="Draw around the portrait" draggable={false} /><svg aria-label="Draw the portrait outline" viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={e => { e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); latest.current = []; setPreview(''); add(point(e)); }} onPointerMove={e => { if (drawing.current) add(point(e)); }} onPointerUp={e => { if (drawing.current) { add(point(e)); drawing.current = false; } }} onPointerCancel={() => { drawing.current = false; }}><polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffed36" strokeWidth="0.004" vectorEffect="non-scaling-stroke" style={{strokeWidth: 3}} /></svg></div>
    <p><label>Background Color <input type="color" value={background} onChange={e => { setBackground(e.target.value); setPreview(''); }} /></label>{' '}<button onClick={makePreview} disabled={busy || points.length < 3}>Preview Cutout</button>{' '}<button onClick={reset} disabled={busy}>Clear Outline</button>{' '}<button onClick={onClose} disabled={busy}>Close Editor</button></p>
    {error && <p role="alert">{error}</p>}
    {preview && <div><h4>Preview</h4><img className="portrait-editor-preview" src={preview} alt="Preview of cropped portrait" /><p><button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Copy to Inbox'}</button></p></div>}
  </section>;
}
