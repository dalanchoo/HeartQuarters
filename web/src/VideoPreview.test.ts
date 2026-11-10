import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { VideoPreview } from './VideoPreview';
describe('inline video preview', () => {
  it('offers play on a placeholder when an export has no cover', () => {
    const html = renderToStaticMarkup(createElement(VideoPreview, { exports: [{ name: 'Short.mp4', path: 'short.mp4', size: 10 }], covers: [] }));
    expect(html).toContain('No thumbnail'); expect(html).toContain('Play Short.mp4');
  });
  it('does not offer play when there is no export', () => {
    const html = renderToStaticMarkup(createElement(VideoPreview, { exports: [], covers: [{ name: 'cover.png', path: 'cover.png', size: 10 }] }));
    expect(html).toContain('cover.png'); expect(html).not.toContain('video-preview-play');
  });
  it('lets a user choose among multiple exports', () => {
    const html = renderToStaticMarkup(createElement(VideoPreview, { exports: [{ name: 'One.mp4', path: 'one.mp4', size: 10 }, { name: 'Two.mp4', path: 'two.mp4', size: 20 }], covers: [] }));
    expect(html).toContain('One.mp4'); expect(html).toContain('Two.mp4');
  });
});
