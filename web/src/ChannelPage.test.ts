import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ChannelProjectCell, ChannelTableHead, ChannelVideoBrowser } from './ChannelPage';
import type { ChannelVideo } from '../../server/channel-videos';
import type { EndScreenData } from '../../server/youtube-end-screens';
import type { SortKey } from './channelRows';

function renderHead(sortKey: SortKey, descending: boolean) {
  return renderToStaticMarkup(createElement(ChannelTableHead, { sortKey, descending, sortBy: () => {} }));
}

it('shows a sort cue on inactive sortable headings and leaves plain headings alone', () => {
  const html = renderHead('publishedAt', true);
  expect(html).toMatch(/Search Views<span[^>]*aria-hidden="true">↕<\/span>/);
  expect(html).toMatch(/Browse Views<span[^>]*aria-hidden="true">↕<\/span>/);
  expect(html).toContain('<th>Topic</th>');
  expect(html).toContain('<th>Angle</th>');
  expect(html).not.toContain('<th>From Longform</th>');
  expect(html).not.toContain('<th>Note</th>');
});

const short: ChannelVideo = {
  id: 'short', kind: 'short', title: 'Short One', piece: '005 - Series/005A - Parent/Shorts/Short One',
  publishedAt: '2026-01-01', seconds: 600, privacy: 'public', kindGuessed: false, numbers: null,
  topic: 'unassigned', topic2: 'unassigned', angle: 'unassigned', angle2: 'unassigned', note: 'Keep this note',
  fromLongform: '005 - Series/005A - Parent/Longform',
};

it('shows a searchable list with the same filters as Overview and waits for a video selection', () => {
  const html = renderToStaticMarkup(createElement(ChannelVideoBrowser, { videos: [short] }));
  expect(html).toContain('type="search"');
  expect(html).toMatch(/<nav[^>]+aria-label="Matching Videos"[^>]*>.*href="#Channel\/Video\/short"[^>]*>Short One<\/a>/);
  expect(html).toContain('Choose a video from the list.');
  for (const label of ['Longform', 'Shorts', 'Standalone', 'All Topics', 'All Angles']) expect(html).toContain(`>${label}</option>`);
});

it('marks the selected video in the list and opens its details from a deep link', () => {
  const selected = { ...short, id: 'abcdefghijk' };
  const html = renderToStaticMarkup(createElement(ChannelVideoBrowser, { videos: [selected], id: selected.id }));
  expect(html).toMatch(/href="#Channel\/Video\/abcdefghijk" aria-current="page"/);
  expect(html).toContain('<h2>Short One</h2>');
});

it('links to the parent project and keeps the note in collapsed details', () => {
  const html = renderToStaticMarkup(createElement(ChannelProjectCell, { video: short, saveNote: () => {} }));
  expect(html).toContain('href="#Channel/Video/short"');
  expect(html).toContain('From <a href="#Videos/005%20-%20Series%2F005A%20-%20Parent"># 005A-Parent</a>');
  const [visible, details] = html.split('<details class="channel-project-details">');
  expect(visible).not.toContain('Keep this note');
  expect(details).toContain('aria-label="Details for Short One"');
  expect(details).toContain('value="Keep this note"');
  expect(details).not.toContain('Edit Source');
});

it('shows Source Unknown for a Short without a known source and omits the source line for Standalone', () => {
  const renderSource = (fromLongform: string | null) => renderToStaticMarkup(createElement(ChannelProjectCell, {
    video: { ...short, fromLongform }, saveNote: () => {},
  }));
  expect(renderSource('standalone')).not.toContain('class="channel-parent"');
  expect(renderSource(null)).toContain('<div class="channel-parent">Source Unknown</div>');
});

it('shows reported end screen clicks and impressions in the video details', () => {
  const activity: EndScreenData = {
    status: 'ready', startDate: '2026-11-10', endDate: '2026-11-12', reportedDays: 3,
    videos: { [short.id]: [{ id: 'element-a', type: 'Playlist', impressions: 40, clicks: 6 }] },
  };
  const html = renderToStaticMarkup(createElement(ChannelProjectCell, { video: short, endScreens: activity, saveNote: () => {} }));
  expect(html.split('<details')[1]).toContain('Playlist · 6 clicks / 40 shown (15.0%)');
  const withoutActivity = renderToStaticMarkup(createElement(ChannelProjectCell, {
    video: { ...short, id: 'other', kind: 'longform' }, endScreens: activity, saveNote: () => {},
  }));
  expect(withoutActivity).toContain('No activity reported for this period.');
});

it('explains missing, pending, and unavailable reports in the longform details', () => {
  const video: ChannelVideo = { ...short, kind: 'longform' };
  const markup = (endScreens?: EndScreenData) => renderToStaticMarkup(createElement(ChannelProjectCell, {
    video, endScreens, saveNote: () => {},
  })).split('<details')[1];
  expect(markup()).toContain('Click Refresh YouTube Data to load end screen activity.');
  expect(markup({ status: 'pending', note: 'YouTube is preparing end screen data.' })).toContain('YouTube is preparing end screen data.');
  expect(markup({ status: 'unavailable', note: 'YouTube could not load the report.' })).toContain('YouTube could not load the report.');
});

it('shows and announces the direction only on the active heading', () => {
  const newest = renderHead('publishedAt', true);
  expect(newest).toMatch(/aria-sort="descending"[^>]*><button[^>]*>Published<span[^>]*>▼/);

  const fewest = renderHead('searchViews', false);
  expect(fewest).toMatch(/aria-sort="ascending"[^>]*><button[^>]*>Search Views<span[^>]*>▲/);
  expect(fewest.match(/aria-sort=/g)).toHaveLength(1);
  expect(fewest).toMatch(/Published<span[^>]*>↕/);
});
