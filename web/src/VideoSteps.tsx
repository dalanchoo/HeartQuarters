import { createContext, useContext } from 'react';
import type { VideoOverview } from '../../server/video-overview';

/** Every video the Videos page knows about, so a part deep inside it (like Made Shorts) can show a video's steps. */
export const OverviewItems = createContext<VideoOverview[]>([]);

/**
 * How far a video is on its way to YouTube: CapCut, Exported, Packaged, Uploaded. Each step is filled when it's done,
 * all in one colour; when every step is done the bar turns a stronger green. Hover a step to see what it checks.
 */
export function VideoSteps({ item }: { item: VideoOverview }) {
  const steps: [string, boolean, string][] = [
    ['CapCut', item.capcut, item.capcut ? 'A CapCut project with this name exists.' : 'No CapCut project with this name.'],
    ['Exported', item.exported, item.exported ? 'A video file is in Exports.' : 'Nothing in Exports yet.'],
    ['Packaged', item.packaged, item.packaged ? 'The newest packaging version has a thumbnail and a YouTube title.' : 'The newest packaging version needs a thumbnail and a YouTube title.'],
    ['Uploaded', item.link === 'linked', item.link === 'linked' ? 'A YouTube link is saved in HeartQuarters.' : item.link === 'unknown' ? 'Whether it is on YouTube could not be determined.' : 'No YouTube link is saved here. This does not mean the video is absent from YouTube.'],
  ];
  const done = steps.every(([, on]) => on);
  return (
    <span className={`video-steps${done ? ' all-done' : ''}`}>
      {steps.map(([label, on, hint]) => (
        <span key={label} className={`video-step${on ? ' on' : ''}`} title={hint}>
          {label}
        </span>
      ))}
    </span>
  );
}

/** The steps for the video at `path`, once the Videos page has its list. */
export function PieceSteps({ path }: { path: string }) {
  const item = useContext(OverviewItems).find((entry) => entry.path === path);
  return item ? <VideoSteps item={item} /> : null;
}
