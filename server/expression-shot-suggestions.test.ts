import { describe, expect, it } from 'vitest';
import { expressionShotSuggestions } from './expression-shot-suggestions';
import type { BriefPick } from './projects';

describe('expression suggestions for the shot list', () => {
  it('includes final picks and labelled ideas from the whole brief without duplicates', () => {
    const picks = [{ title: 'A Title', expression: 'Positive > Warmth (gentle smile)' }] as BriefPick[];
    const brief = '### Idea 1: Welcome\n- **Expression:** Positive > Warmth (gentle smile)\n### Idea 2: Calm\n- Expression: Composure > Calm (open eyes)\n## Review\n- **Expression categories:** Empathy > Compassion; soft and steady.\nA sentence about expression: ignored.';
    expect(expressionShotSuggestions(brief, picks)).toEqual([
      { expression: 'Positive > Warmth (gentle smile)', context: 'Top 1: A Title' },
      { expression: 'Composure > Calm (open eyes)', context: 'Idea 2: Calm' },
      { expression: 'Empathy > Compassion; soft and steady.', context: 'Review' },
    ]);
  });
  it('keeps the full suggested look, including multi-level categories and punctuation', () => {
    const expression = 'Positive > Relief, Composure > Resolute, Positive > Warmth (open eyes, a quiet, relieved half-smile, the look of someone who has just come back)';
    expect(expressionShotSuggestions(`### Idea 1\nExpression: ${expression}`, [])).toEqual([{ expression, context: 'Idea 1' }]);
  });
});
