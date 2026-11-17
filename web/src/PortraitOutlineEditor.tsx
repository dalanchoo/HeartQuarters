import { useRef, useState } from 'react';
import { fileUrl, postJson, type ExpressionPhoto } from './api';
import { isAiExpression } from '../../server/expression-origin';
import type { Point } from './portrait-outline';
import { strengthenMask, subjectBounds } from './portrait-segmentation';

type Stroke = { mode: 'restore' | 'erase'; points: Point[]; width: number };

export function PortraitOutlineEditor({ photo, onClose, onSaved }: { photo: ExpressionPhoto; onClose: () => void; onSaved: () => void }) {
  const image = useRef<HTMLImageElement>(null), drawing = useRef(false), latest = useRef<Point[]>([]), cutout = useRef<HTMLCanvasElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]), [preview, setPreview] = useState('');
  const [background, setBackground] = useState('#d6d6d6'), [strength, setStrength] = useState(128);
  const [mode, setMode] = useState<'outline' | 'restore' | 'erase'>('outline'), [brushSize, setBrushSize] = useState(4);
  const [strokes, setStrokes] = useState<Stroke[]>([]); const activeStroke = useRef<Stroke | null>(null);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const point = (e: React.PointerEvent<SVGSVGElement>): Point => { const rect = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)) }; };
  const add = (p: Point) => { latest.current = [...latest.current, p]; setPoints(latest.current); };
  const reset = () => { latest.current = []; setPoints([]); setStrokes([]); setPreview(''); setError(''); };
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
          // Keep the original soft mask so it can be adjusted without running the model again.
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          cutout.current = canvas;
        } finally { bitmap.close(); }
      }
      const masked = document.createElement('canvas'); masked.width = img.naturalWidth; masked.height = img.naturalHeight;
      const ctx = masked.getContext('2d', { willReadFrequently: true }); if (!ctx) throw new Error('Could not prepare the image.');
      const modelMask = cutout.current.getContext('2d', { willReadFrequently: true }); if (!modelMask) throw new Error('Could not read the selection mask.');
      const alpha = modelMask.getImageData(0, 0, masked.width, masked.height); strengthenMask(alpha.data, strength);
      const maskCanvas = document.createElement('canvas'); maskCanvas.width = masked.width; maskCanvas.height = masked.height;
      const maskCtx = maskCanvas.getContext('2d'); if (!maskCtx) throw new Error('Could not adjust the mask.'); maskCtx.putImageData(alpha, 0, 0);
      if (points.length >= 3) { ctx.beginPath(); points.forEach((p, i) => { const x = p.x * masked.width, y = p.y * masked.height; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.closePath(); ctx.clip(); }
      ctx.save(); ctx.drawImage(img, 0, 0); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(maskCanvas, 0, 0); ctx.restore();
      for (const stroke of strokes) {
        const brush = document.createElement('canvas'); brush.width = masked.width; brush.height = masked.height;
        const b = brush.getContext('2d'); if (!b) throw new Error('Could not apply a brush stroke.');
        b.lineWidth = stroke.width * masked.width; b.lineCap = 'round'; b.lineJoin = 'round'; b.strokeStyle = 'white'; b.fillStyle = 'white';
        b.beginPath(); const first = stroke.points[0]; b.moveTo(first.x * masked.width, first.y * masked.height);
        stroke.points.forEach(p => b.lineTo(p.x * masked.width, p.y * masked.height)); b.stroke();
        if (stroke.points.length === 1) { b.beginPath(); b.arc(first.x * masked.width, first.y * masked.height, b.lineWidth / 2, 0, Math.PI * 2); b.fill(); }
        ctx.save();
        if (stroke.mode === 'erase') { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(brush, 0, 0); }
        else { b.globalCompositeOperation = 'source-in'; b.drawImage(img, 0, 0); ctx.drawImage(brush, 0, 0); }
        ctx.restore();
      }
      const bounds = subjectBounds(ctx.getImageData(0, 0, masked.width, masked.height).data, masked.width, masked.height);
      const result = document.createElement('canvas'); result.width = bounds.width; result.height = bounds.height;
      const output = result.getContext('2d'); if (!output) throw new Error('Could not create the preview.');
      output.fillStyle = background; output.fillRect(0, 0, result.width, result.height); output.drawImage(masked, -bounds.x, -bounds.y);
      setPreview(result.toDataURL('image/png'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); setStatus(''); }
  };
  const save = async () => { setBusy(true); setError(''); try { await postJson('/api/expressions/inbox/import', { name: `${photo.name} - Cutout.png`, data: preview.split(',')[1], ai: isAiExpression(photo) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  return <section className="portrait-editor"><h3>Select and Crop: {photo.name}</h3>
    <p>Select the person automatically, then use Keep or Remove to brush over any mistakes. An optional loose outline limits the selection. The original photo is unchanged.</p>
    <p><strong>Tool:</strong>{' '}{(['outline', 'restore', 'erase'] as const).map(value => <label key={value} style={{ marginRight: '1em' }}><input type="radio" name="portrait-tool" checked={mode === value} disabled={busy} onChange={() => setMode(value)} /> {value === 'outline' ? 'Rough Outline' : value === 'restore' ? 'Keep' : 'Remove'}</label>)} {mode !== 'outline' && <label>Brush Size <input type="range" min="1" max="15" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} /> {brushSize}%</label>}</p>
    <div className="portrait-editor-image"><img ref={image} src={fileUrl('expressions', photo.path, photo.revision)} alt="Photo for subject selection" draggable={false} /><svg aria-label="Draw on the photo" viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={e => { if (busy) return; e.preventDefault(); drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); setPreview(''); const p = point(e); if (mode === 'outline') { latest.current = []; add(p); } else { const stroke: Stroke = { mode, points: [p], width: brushSize / 100 }; activeStroke.current = stroke; setStrokes(old => [...old, stroke]); } }} onPointerMove={e => { if (!drawing.current) return; const p = point(e); if (mode === 'outline') add(p); else if (activeStroke.current) { const next = { ...activeStroke.current, points: [...activeStroke.current.points, p] }; activeStroke.current = next; setStrokes(old => [...old.slice(0, -1), next]); } }} onPointerUp={() => { drawing.current = false; activeStroke.current = null; }} onPointerCancel={() => { drawing.current = false; activeStroke.current = null; }}><polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#ffed36" vectorEffect="non-scaling-stroke" style={{strokeWidth: 3}} />{strokes.map((stroke, i) => <polyline key={i} points={stroke.points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={stroke.mode === 'restore' ? '#2dcc71' : '#fa514f'} strokeWidth={stroke.width} opacity="0.6" strokeLinecap="round" strokeLinejoin="round" />)}</svg></div>
    <p><label>Background Color <input type="color" value={background} disabled={busy} onChange={e => { setBackground(e.target.value); setPreview(''); }} /></label>{' '}<label>Foreground Opacity <input type="range" min="64" max="255" step="1" value={319 - strength} disabled={busy} onChange={e => { setStrength(319 - Number(e.target.value)); setPreview(''); }} /></label>{' '}<button onClick={() => void makePreview()} disabled={busy}>Select Subject and Preview</button>{' '}<button onClick={reset} disabled={busy}>Clear Corrections</button>{' '}<button onClick={onClose} disabled={busy}>Close Editor</button></p>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    {preview && <div><h4>Preview</h4><p>If the background shows through clothing, increase Foreground Opacity or brush that area with Keep. Brush unwanted background with Remove, then preview again.</p><img className="portrait-editor-preview" src={preview} alt="Preview of cropped portrait" /><p><button disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save Copy to Inbox'}</button></p></div>}
  </section>;
}
