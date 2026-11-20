import type { VideoOverview } from '../../server/video-overview';

/**
 * How far a video is on its way to YouTube: CapCut, Exported, Metadata, Thumbnail, Uploaded. Each step is filled when it's done,
 * all in one colour; when every step is done the bar turns a stronger green. Hover a step to see what it checks.
 */
export function VideoSteps({ item }: { item: VideoOverview }) {
  const steps: [string, boolean, string][] = [
    ['CapCut', item.capcut, item.capcut ? 'A CapCut project with this name exists.' : 'No CapCut project with this name.'],
    ['Exported', item.exported, item.exported ? 'A video file is in Exports.' : 'Nothing in Exports yet.'],
    ['Metadata', !item.metadataMissing.length, item.metadataMissing.length ? `The newest packaging version's YouTube text still needs: ${item.metadataMissing.join(', ')}.` : "The newest packaging version's YouTube text has every field filled in."],
    ['Thumbnail', item.localThumbnail, item.localThumbnail ? 'The newest packaging version has a thumbnail.' : 'The newest packaging version has no Thumbnail\\Thumbnail.png or .jpg.'],
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
