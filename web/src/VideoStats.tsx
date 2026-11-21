// A quick look at how a video is doing, from one downloaded Stats.json: the headline numbers (like the top of
// YouTube Studio's Analytics), audience retention, and where views came from. Read-only; nothing is sent to YouTube.
import { useEffect, useMemo, useState } from 'react';
import { getText } from './api';
import { summarizeSnapshot, type Breakdown, type PeriodStats, type StatsSummary } from '../../server/analytics-summary';

const whole = new Intl.NumberFormat('en-US');
const oneDecimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const show = (n: number | null, format: (n: number) => string = v => whole.format(Math.round(v))) => n === null ? '—' : format(n);
const duration = (seconds: number) => { const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const day = (iso: string) => iso.slice(0, 10);

export function VideoStats({ piece, snapshot }: { piece: string; snapshot: string }) {
  const [summary, setSummary] = useState<StatsSummary | null>(null);
  const [downloadedAt, setDownloadedAt] = useState('');
  const [error, setError] = useState('');
  const [periodName, setPeriodName] = useState('Lifetime to Date');
  useEffect(() => {
    let active = true; setSummary(null); setError('');
    getText('projects', `${piece}/Analytics/${snapshot}/Stats.json`).then(text => {
      if (!active) return;
      const data = JSON.parse(text) as Parameters<typeof summarizeSnapshot>[0];
      setSummary(summarizeSnapshot(data)); setDownloadedAt(data.downloadedAt ?? '');
    }, (e: Error) => { if (active) setError(`Could not read these stats: ${e.message}`); });
    return () => { active = false; };
  }, [piece, snapshot]);
  const period = useMemo(() => summary?.periods.find(p => p.name === periodName) ?? summary?.periods.at(-1), [summary, periodName]);
  if (error) return <p className="error">{error}</p>;
  if (!summary || !period) return <p className="muted small-text">Loading stats…</p>;
  const reach = summary.reach;
  return <section className="video-stats" aria-label="Video Stats">
    <div className="video-stats-head">
      <div className="video-stats-periods" role="group" aria-label="Period">
        {summary.periods.map(p => <button key={p.name} type="button" className="small" aria-pressed={p.name === period.name} onClick={() => setPeriodName(p.name)}>{p.name}{!p.complete && p.name !== 'Lifetime to Date' ? ' (So Far)' : ''}</button>)}
      </div>
      <span className="muted small-text">{day(period.start)} to {day(period.end)}{downloadedAt ? ` · Downloaded ${new Date(downloadedAt).toLocaleString()}` : ''}</span>
    </div>
    {period.views === null && <p className="muted small-text">YouTube had no numbers for this period yet.</p>}
    <div className="video-stats-tiles">
      <Tile label="Views" value={show(period.views)} />
      <Tile label="Watch Time" value={show(period.watchHours, h => h < 1 ? `${whole.format(Math.round(h * 60))} minutes` : `${oneDecimal.format(h)} hours`)} />
      <Tile label="Average View Duration" value={show(period.averageViewSeconds, duration)} />
      <Tile label="Average Percentage Viewed" value={show(period.averageViewPercent, p => `${oneDecimal.format(p)}%`)} />
      <Tile label="Subscribers" value={show(period.subscribersNet, n => `${n > 0 ? '+' : ''}${whole.format(n)}`)} />
      <Tile label="Likes" value={show(period.likes)} />
      <Tile label="Comments" value={show(period.comments)} />
      <Tile label="Shares" value={show(period.shares)} />
      <Tile label="Impressions" value={reach ? whole.format(reach.impressions) : 'Not Ready'} note={reach ? `${day(reach.from)} to ${day(reach.to)}` : undefined} />
      <Tile label="Impressions Click-Through Rate" value={reach ? show(reach.ctrPercent, p => `${oneDecimal.format(p)}%`) : 'Not Ready'} note={reach ? 'Same days as impressions' : undefined} />
    </div>
    {!reach && <p className="muted small-text">Impressions and CTR: {summary.reachNote || 'not downloaded with these stats.'}</p>}
    {reach && <p className="muted small-text">Impressions and CTR cover only the days YouTube has sent reach reports for, whatever period is chosen above.</p>}
    <div className="video-stats-charts">
      <Retention period={period} />
      <Bars title="Traffic Sources" items={summary.trafficSources} note="Lifetime to date" />
      <Bars title="Devices" items={summary.devices} note="Lifetime to date" />
      {summary.countries.length > 0 && <Bars title="Countries" items={summary.countries} note="Lifetime to date" />}
    </div>
  </section>;
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="video-stats-tile"><span className="video-stats-label">{label}</span><strong>{value}</strong>{note && <span className="muted small-text">{note}</span>}</div>;
}

/** Audience retention as a line: how many viewers are still watching at each point of the video. */
function Retention({ period }: { period: PeriodStats }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = period.retention;
  if (!points.length) return <div className="video-stats-chart"><h4>Audience Retention</h4><p className="muted small-text">YouTube had no retention for this period.</p></div>;
  const W = 320, H = 140, left = 34, bottom = 18, top = 8, right = 8;
  const maxY = Math.max(1, Math.ceil(Math.max(...points.map(p => p.watching)) * 4) / 4);
  const x = (at: number) => left + at * (W - left - right);
  const y = (v: number) => top + (1 - v / maxY) * (H - top - bottom);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.watching).toFixed(1)}`).join(' ');
  const ticks = maxY > 1 ? [0, 1, maxY] : [0, 0.5, 1]; // 100% is always marked: above it, people re-watched.
  const near = hover === null ? null : points.reduce((best, p) => Math.abs(p.at - hover) < Math.abs(best.at - hover) ? p : best, points[0]);
  return <div className="video-stats-chart">
    <h4>Audience Retention</h4>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Audience retention for ${period.name}: ${Math.round(points[0].watching * 100)}% at the start, ${Math.round(points.at(-1)!.watching * 100)}% at the end.`}
      onMouseMove={e => { const box = e.currentTarget.getBoundingClientRect(); const at = ((e.clientX - box.left) / box.width * W - left) / (W - left - right); setHover(Math.min(1, Math.max(0, at))); }}
      onMouseLeave={() => setHover(null)}>
      {ticks.map(t => <g key={t}><line x1={left} x2={W - right} y1={y(t)} y2={y(t)} className="video-stats-grid" /><text x={left - 4} y={y(t) + 3} textAnchor="end" className="video-stats-axis">{Math.round(t * 100)}%</text></g>)}
      <text x={left} y={H - 4} className="video-stats-axis">Start</text>
      <text x={W - right} y={H - 4} textAnchor="end" className="video-stats-axis">End</text>
      <path d={line} className="video-stats-line" />
      {near && <g><line x1={x(near.at)} x2={x(near.at)} y1={top} y2={H - bottom} className="video-stats-cross" /><circle cx={x(near.at)} cy={y(near.watching)} r="4" className="video-stats-dot" /></g>}
    </svg>
    <p className="muted small-text" aria-live="polite">{near ? `${Math.round(near.at * 100)}% into the video: ${Math.round(near.watching * 100)}% still watching` : 'Above 100% means people re-watched that part. Point at the line for details.'}</p>
  </div>;
}

/** Where views came from, as bars with the share of views written next to each. */
function Bars({ title, items, note }: { title: string; items: Breakdown[]; note: string }) {
  const shown = items.slice(0, 6);
  return <div className="video-stats-chart">
    <h4>{title} <span className="muted small-text">{note}</span></h4>
    {!shown.length ? <p className="muted small-text">YouTube had no data for this yet.</p> : <ul className="video-stats-bars">
      {shown.map(item => <li key={item.label} title={`${item.label}: ${whole.format(item.views)} views`}>
        <span className="video-stats-bar-label">{item.label}</span>
        <span className="video-stats-bar-track"><span className="video-stats-bar" style={{ width: `${Math.max(2, item.share * 100)}%` }} /></span>
        <span className="video-stats-bar-value">{Math.round(item.share * 100)}%</span>
      </li>)}
    </ul>}
    {items.length > shown.length && <p className="muted small-text">{items.length - shown.length} smaller sources not shown.</p>}
  </div>;
}
