import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PackagingChoice } from './PackagingCompare';
import { YOUTUBE_SELECTION } from './comparisonSelection';

describe('packaging comparison menu', () => {
  it('shows the YouTube icon in the selected value and menu while naming it for screen readers', () => {
    const html = renderToStaticMarkup(createElement(PackagingChoice, { name: 'Compare With', value: YOUTUBE_SELECTION, options: ['', YOUTUBE_SELECTION], label: value => value || 'None — View One', onChange: () => undefined }));
    expect(html.match(/class="youtube-icon"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Compare With: YouTube"');
    expect(html).toContain('aria-label="YouTube"');
    expect(html).not.toContain('>▶<');
  });
});
