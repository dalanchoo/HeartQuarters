import { useEffect, useState } from 'react';
import { getJson, openInExplorer, postJson, type LinkState, type SkillInfo, type SkillsOverview } from './api';

// Which AI on this PC gets which skill. Ticking a box puts a link to the skill in that
// AI's skills folder; unticking removes the link (the skill itself is never touched).
export function SkillsPage() {
  const [data, setData] = useState<SkillsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => getJson<SkillsOverview>('/api/skills').then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const toggle = (s: SkillInfo, targetId: string, on: boolean) => {
    const key = `${s.id}|${targetId}`;
    setBusy(key);
    setError(null);
    postJson<{ state: LinkState }>('/api/skills/link', { skill: s.id, target: targetId, on })
      .then(load, (e) => setError(e.message))
      .finally(() => setBusy(null));
  };

  if (!data) return <div className="content wide">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;

  const groups = [
    { title: 'My skills', folder: 'HMF_Skills', skills: data.skills.filter((s) => s.group === 'mine') },
    { title: 'Downloaded', folder: 'Downloaded', skills: data.skills.filter((s) => s.group === 'downloaded') },
  ];

  return (
    <div className="content wide">
      <h1>Skills</h1>
      <p className="muted">
        One real copy of each skill lives in HMF_SYS\Skills. Tick a box to give that skill to an AI on this PC (a link
        goes into the AI's skills folder); untick to take it away. The skill itself is never changed.
      </p>
      {error && <p className="error">{error}</p>}

      <table className="skills-table">
        <thead>
          <tr>
            <th>Skill</th>
            {data.targets.map((t) => (
              <th key={t.id} className="ai" title={t.dir}>
                {t.name}
                {t.installed ? (
                  <div>
                    <button
                      className="small"
                      onClick={() => postJson('/api/skills/open', { target: t.id }).catch((e) => setError(e.message))}
                    >
                      Open folder
                    </button>
                  </div>
                ) : (
                  <div className="muted small-text">not installed</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.folder}>
            <tr className="group-row">
              <td colSpan={data.targets.length + 1}>
                <h4>
                  {g.title}
                  <button className="small" onClick={() => openInExplorer('skills', g.folder).catch((e) => setError(e.message))}>
                    Open folder
                  </button>
                </h4>
              </td>
            </tr>
            {g.skills.length === 0 && (
              <tr>
                <td colSpan={data.targets.length + 1} className="muted">
                  None yet. Put a skill folder (with its SKILL.md) in HMF_SYS\Skills\{g.folder}.
                </td>
              </tr>
            )}
            {g.skills.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.name}</strong>
                  <div className="muted small-text">{s.description}</div>
                </td>
                {data.targets.map((t) => {
                  const st = s.links[t.id];
                  const key = `${s.id}|${t.id}`;
                  return (
                    <td key={t.id} className="ai">
                      {st === 'other' ? (
                        <span className="muted small-text" title="Its skills folder already has something with this name that isn't a link to this skill.">
                          other copy
                        </span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={st === 'on'}
                          disabled={busy !== null || (!t.installed && st !== 'on')}
                          onChange={(e) => toggle(s, t.id, e.target.checked)}
                          aria-label={`${s.name} for ${t.name}`}
                        />
                      )}
                      {busy === key && <span className="muted small-text"> …</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <h3>Also in the AIs' skills folders</h3>
      <p className="muted small-text">Installed some other way (not from HMF_SYS\Skills), so this page leaves them alone.</p>
      {data.targets.map((t) => (
        <p key={t.id} className="small-text">
          <strong>{t.name}:</strong>{' '}
          {t.others.length ? t.others.join(', ') : <span className="muted">nothing else</span>}
          <span className="muted mono"> ({t.dir})</span>
        </p>
      ))}
    </div>
  );
}
