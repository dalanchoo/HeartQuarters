import { useEffect, useRef, useState } from 'react';
import { getJson, postJson, type Job } from './api';

interface Tool {
  id: string;
  name: string;
  description: string;
  script: string;
  found: boolean;
  lastJob: Job | null;
}

// Lists the Python tools from config.json, with a Run button and live output.
export function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<Tool[]>('/api/tools').then(setTools, (e) => setError(e.message));
  }, []);

  return (
    <div className="content wide">
      <h1>Tools</h1>
      <p className="muted">
        These run the scripts in your HMF_SYS\Tools folder, exactly as if you ran them yourself.
      </p>
      {error && <p className="error">{error}</p>}
      {tools.map((t) => (
        <ToolCard key={t.id} tool={t} />
      ))}
    </div>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const [job, setJob] = useState<Job | null>(tool.lastJob);
  const [error, setError] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  // While a job runs, ask the server for its output once a second.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = setInterval(() => {
      getJson<Job>(`/api/jobs/${job.id}`).then(setJob, (e) => setError(e.message));
    }, 1000);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [job?.output]);

  const run = () => {
    setError(null);
    postJson<Job>(`/api/tools/${tool.id}/run`).then(setJob, (e) => setError(e.message));
  };

  return (
    <div className="card tool">
      <div className="tool-head">
        <div>
          <strong>{tool.name}</strong>
          <div className="muted">{tool.description}</div>
          <div className="muted mono">{tool.script}</div>
        </div>
        <div className="tool-status">
          {job && <span className={`status ${job.status}`}>{job.status}</span>}
          <button onClick={run} disabled={!tool.found || job?.status === 'running'}>
            {job?.status === 'running' ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>
      {!tool.found && <p className="error">Script not found in the tools folder.</p>}
      {error && <p className="error">{error}</p>}
      {job && (
        <pre ref={outputRef} className="output">
          {job.output || '(no output yet)'}
        </pre>
      )}
    </div>
  );
}
