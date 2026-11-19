import { expect, it } from 'vitest';
import { analyticsSummarySections } from './analyticsSummary';
it('splits summaries into separately collapsible sections and keeps older text', () => {
  expect(analyticsSummarySections('Intro\n\n## Key Findings\n- A\n\n### What to Try\n- B')).toEqual([{ title: '', body: 'Intro' }, { title: 'Key Findings', body: '- A' }, { title: 'What to Try', body: '- B' }]);
  expect(analyticsSummarySections('An older summary')).toEqual([{ title: '', body: 'An older summary' }]);
});
