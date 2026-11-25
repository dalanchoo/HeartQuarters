// Channel -> Research: topic-level research. "Your Channel Evidence" (comments + transcripts of videos tagged with a
// topic) is kept apart from "Outside Demand" (what other YouTube channels made on the topic).
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getJson, postJson } from './api';
import type { AiId } from '../../server/ai';
import type { ResearchReport, ResearchTopic, TopicCount, TopicEvidence, TopicResearch } from '../../server/channel-research';
import { OutsideDemand } from './OutsideDemand';
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
  const [chatting, setChatting] = useState(false);
  const busy = !!asking || chatting;
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
    if (!topic || busy) return;
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
    <section className="channel-research card">
      <h2>Topic Research</h2>
      <nav className="research-topics" aria-label="Research Topics">
        {counts === null && !error && <span className="muted small-text">Loading Topics…</span>}
        {counts?.map((c) => (
          <button
            key={c.topic}
            type="button"
            className={c.topic === topic ? 'small active' : 'small'}
            aria-current={c.topic === topic ? 'page' : undefined}
            title={`${c.videos} videos, ${c.comments} viewer comments`}
            onClick={() => { window.location.hash = researchHash(c.topic); }}
          >
            {TOPIC_LABELS[c.topic]} <span className="topic-count">{c.videos}</span>
          </button>
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
                <details className="yt-section research-sub">
                  <summary>
                    Videos Used <span className="muted">{evidence.videos.length} videos · {evidence.commentCount} viewer comments · {evidence.transcriptCount} transcripts</span>
                  </summary>
                  <ul className="research-videos">
                    {evidence.videos.map((v) => (
                      <li key={v.id}>
                        {v.title} <span className="muted">({v.kind === 'short' ? 'Short' : 'Longform'}, {v.comments} comments{v.transcript ? '' : ', no transcript'})</span>{' '}
                        <a href={`#Channel/Comments/${encodeURIComponent(v.id)}`}>Comments</a>
                      </li>
                    ))}
                  </ul>
                </details>
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
                    <button key={ai.id} type="button" className="small" disabled={busy || !evidence.videos.length} onClick={() => void run(ai.id)}>
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
                <ReportConversation topic={topic} report={r} busy={busy} setBusy={setChatting} onSaved={setResearch} />
              </details>
            ))}
          </details>

          <details className="yt-section">
            <summary>Outside Demand</summary>
            <OutsideDemand key={topic} topic={topic} />
          </details>
        </>
      )}
    </section>
  );
}

/** The follow-up conversation under a report: John writes, then picks which AI answers this turn. */
function ReportConversation({ topic, report, busy, setBusy, onSaved }: {
  topic: ResearchTopic; report: ResearchReport; busy: boolean; setBusy: (busy: boolean) => void; onSaved: (research: TopicResearch) => void;
}) {
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState<AiId | null>(null);
  const [error, setError] = useState('');

  const send = async (ai: AiId) => {
    const message = draft.trim();
    if (!message || busy) return;
    setAsking(ai);
    setBusy(true);
    setError('');
    try {
      onSaved(await postJson<TopicResearch>('/api/channel/research/message', { topic, reportId: report.id, ai, message }));
      setDraft('');
    } catch (e) {
      setError((e as Error).message);
      // John's message may have been saved before the AI failed, so show what Drive has now.
      void getJson<{ research: TopicResearch }>(`/api/channel/research?topic=${encodeURIComponent(topic)}`).then((data) => onSaved(data.research), () => {});
    } finally {
      setAsking(null);
      setBusy(false);
    }
  };

  return (
    <div className="research-chat">
      <h3>Discuss This Report</h3>
      {report.messages.map((m) => (
        <div key={m.id} className={`brainstorm-msg brainstorm-msg--${m.from}`}>
          <div className="brainstorm-msg-head">
            <strong>{m.from === 'john' ? 'John' : aiName(m.from)}</strong>
            <span className="muted small-text">{formatWhen(m.at)}</span>
          </div>
          {m.from === 'john'
            ? <div className="brainstorm-msg-text">{m.text}</div>
            : <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown></div>}
        </div>
      ))}
      {error && <p className="error" role="alert">{error}</p>}
      <textarea
        rows={2}
        className="research-focus"
        placeholder="Ask a follow-up, push back, or try an idea of your own…"
        value={draft}
        maxLength={20000}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="research-actions">
        {AIS.map((ai) => (
          <button key={ai.id} type="button" className="small" disabled={busy || !draft.trim()} onClick={() => void send(ai.id)}>
            {asking === ai.id ? `${ai.name} Is Replying…` : `Send to ${ai.name}`}
          </button>
        ))}
      </div>
      {asking && <p className="muted small-text" role="status">The AI rereads the evidence, so a reply can take a few minutes.</p>}
    </div>
  );
}
