// Channel -> Research: topic-level research. "Your Channel Evidence" (comments + transcripts of videos tagged with a
// topic) is kept apart from "Outside Demand" (Reddit, news, vidIQ), which is not built yet.
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, postJson } from './api';
import type { AiId } from '../../server/ai';
import type { ResearchTopic, TopicCount, TopicEvidence, TopicResearch } from '../../server/channel-research';
import { TOPIC_LABELS } from './videoProfile';

const AIS: { id: AiId; name: string }[] = [{ id: 'claude', name: 'Claude' }, { id: 'codex', name: 'ChatGPT' }, { id: 'gemini', name: 'Gemini' }];
const aiName = (id: AiId) => AIS.find((a) => a.id === id)?.name ?? id;
const researchHash = (topic: string) => `#Channel/Research/${encodeURIComponent(topic)}`;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ChannelResearch({ topic: rawTopic }: { topic?: string }) {
  const [counts, setCounts] = useState<TopicCount[] | null>(null);
  const [evidence, setEvidence] = useState<TopicEvidence | null>(null);
  const [research, setResearch] = useState<TopicResearch | null>(null);
  const [focus, setFocus] = useState('');
  const [asking, setAsking] = useState<AiId | null>(null);
  const [showVideos, setShowVideos] = useState(false);
  const [error, setError] = useState('');
  const topic = counts?.some((c) => c.topic === rawTopic) ? rawTopic as ResearchTopic : undefined;

  useEffect(() => {
    getJson<TopicCount[]>('/api/channel/research/topics').then(setCounts, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!topic) return;
    let active = true;
    setEvidence(null);
    setResearch(null);
    setError('');
    getJson<{ evidence: TopicEvidence; research: TopicResearch }>(`/api/channel/research?topic=${encodeURIComponent(topic)}`).then(
      (data) => { if (active) { setEvidence(data.evidence); setResearch(data.research); } },
      (e: Error) => { if (active) setError(e.message); },
    );
    return () => { active = false; };
  }, [topic]);

  const run = async (ai: AiId) => {
    if (!topic || asking) return;
    setAsking(ai);
    setError('');
    try {
      setResearch(await postJson<TopicResearch>('/api/channel/research/run', { topic, ai, focus }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };

  return (
    <section className="channel-research">
      <h2>Topic Research</h2>
      <nav className="research-topics" aria-label="Research Topics">
        {counts === null && !error && <span className="muted small-text">Loading Topics…</span>}
        {counts?.map((c) => (
          <a key={c.topic} href={researchHash(c.topic)} className="small" aria-current={c.topic === topic ? 'page' : undefined}>
            {TOPIC_LABELS[c.topic]} <span className="muted">({c.videos} Videos, {c.comments} Comments)</span>
          </a>
        ))}
      </nav>
      {error && <p className="error" role="alert">{error}</p>}
      {!topic && counts && <p className="muted">Choose a topic. Videos count when their Topic or Second Topic (About This Video) is that topic.</p>}

      {topic && (
        <>
          <details className="yt-section" open>
            <summary>Your Channel Evidence</summary>
            <p className="muted small-text">
              What Heart Mind Fusion's own viewers said (downloaded comments) and what you said (transcripts), across every video tagged {TOPIC_LABELS[topic]}.
              Sync comments in Channel → Comments first for the freshest evidence.
            </p>
            {evidence === null && !error && <p className="muted small-text">Gathering Evidence…</p>}
            {evidence && (
              <>
                <button type="button" className="research-toggle small-text" aria-expanded={showVideos} onClick={() => setShowVideos(!showVideos)}>
                  {showVideos ? '▼' : '▶'} {evidence.videos.length} Videos · {evidence.commentCount} Viewer Comments · {evidence.transcriptCount} Transcripts
                </button>
                {showVideos && (
                  <ul className="research-videos small-text">
                    {evidence.videos.map((v) => (
                      <li key={v.id}>
                        {v.title} <span className="muted">({v.kind === 'short' ? 'Short' : 'Longform'}, {v.comments} comments{v.transcript ? '' : ', no transcript'})</span>{' '}
                        <a href={`#Channel/Comments/${encodeURIComponent(v.id)}`}>Comments</a>
                      </li>
                    ))}
                  </ul>
                )}
                <textarea
                  rows={2}
                  className="research-focus"
                  placeholder="Optional question for this run, for example: What do viewers ask about dreams?"
                  value={focus}
                  maxLength={2000}
                  onChange={(e) => setFocus(e.target.value)}
                />
                <div className="research-actions">
                  {AIS.map((ai) => (
                    <button key={ai.id} type="button" className="small" disabled={!!asking || !evidence.videos.length} onClick={() => void run(ai.id)}>
                      {asking === ai.id ? `${ai.name} Is Researching…` : `Research With ${ai.name}`}
                    </button>
                  ))}
                </div>
                {asking && <p className="muted small-text" role="status">This reads every comment and transcript and can take several minutes.</p>}
              </>
            )}
            {research?.reports.map((r, i) => (
              <details className="yt-section" key={r.id} open={i === 0}>
                <summary>
                  {aiName(r.ai)} Report, {formatWhen(r.at)}{' '}
                  <span className="muted small-text">({r.videos.length} Videos, {r.commentCount} Comments)</span>
                </summary>
                {r.focus && <p className="muted small-text">Question: {r.focus}</p>}
                <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{r.text}</ReactMarkdown></div>
              </details>
            ))}
          </details>

          <details className="yt-section">
            <summary>Outside Demand</summary>
            <p className="muted small-text">
              Kept separate from your channel evidence. Planned sources: Reddit (for example r/SDAM), news, vidIQ, and Ask Studio.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
