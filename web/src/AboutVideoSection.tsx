import { useEffect, useState } from 'react';
import { getJson, postJson } from './api';
import type { Angle, Topic, VideoProfile } from '../../server/video-profile';
import { ANGLE_LABELS, TOPIC_LABELS, pairLabel } from './videoProfile';

/** The choices for a Topic or Angle. For the second one, "Unassigned" reads as "None". */
function Options({ labels, second }: { labels: Record<string, string>; second?: boolean }) {
  return <>{Object.entries(labels).map(([id, label]) => <option key={id} value={id}>{second && id === 'unassigned' ? 'None' : label}</option>)}</>;
}

// "About This Video": John's own Topic and Angle (each with an optional second one) and a note.
// Saved in the video's Drive folder; the Channel tab shows and edits the same record.
export function AboutVideoSection({ piece }: { piece: string }) {
  const [profile, setProfile] = useState<VideoProfile | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    getJson<VideoProfile>(`/api/video-profile?piece=${encodeURIComponent(piece)}`).then((p) => { if (current) { setProfile(p); setNote(p.note); } }, (e: Error) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [piece]);

  const save = async (next: VideoProfile) => {
    setError('');
    try { const saved = await postJson<VideoProfile>('/api/video-profile', { piece, ...next }); setProfile(saved); setNote(saved.note); }
    catch (e) { setError((e as Error).message); }
  };

  const confirm = () => { if (profile) void save({ ...profile, suggested: false }); };
  const summary = profile && [profile.suggested && 'guess', pairLabel(profile.topic, profile.topic2, TOPIC_LABELS), pairLabel(profile.angle, profile.angle2, ANGLE_LABELS)].filter(Boolean).join(' · ');
  return (
    <details className="yt-section">
      <summary>About This Video{summary ? <span className="muted"> · {summary}</span> : null}</summary>
      {error && <p className="error">{error}</p>}
      {profile?.suggested && (
        <p className="muted about-guess">Topic and Angle are Claude's guess. Change them, or <button type="button" className="small" onClick={confirm}>Confirm</button></p>
      )}
      {profile && (
        <div className="about-video">
          <label>Topic
            <select value={profile.topic} onChange={(e) => void save({ ...profile, topic: e.target.value as Topic })}><Options labels={TOPIC_LABELS} /></select>
          </label>
          <label>Second Topic
            <select value={profile.topic2} onChange={(e) => void save({ ...profile, topic2: e.target.value as Topic })}><Options labels={TOPIC_LABELS} second /></select>
          </label>
          <label>Angle
            <select value={profile.angle} onChange={(e) => void save({ ...profile, angle: e.target.value as Angle })}><Options labels={ANGLE_LABELS} /></select>
          </label>
          <label>Second Angle
            <select value={profile.angle2} onChange={(e) => void save({ ...profile, angle2: e.target.value as Angle })}><Options labels={ANGLE_LABELS} second /></select>
          </label>
          <label className="about-note">Notes
            <textarea rows={3} value={note} maxLength={2000} placeholder="For example: my best video, or I dislike this thumbnail"
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (note.trim() !== profile.note) void save({ ...profile, note }); }} />
          </label>
        </div>
      )}
    </details>
  );
}
