import { describe, expect, it } from 'vitest';
import { mergeExpressionSidecars } from './expression-sidecar-merge';

describe('merging expression sidecars', () => {
  it('uses GPT scores, only physical Sonnet guesses, and preserves all confirmed decisions', () => {
    const gpt = 'Morphology\n==========\nSmile, 80%, UNCONFIRMED\n\nExpression\n==========\nCuriosity, 65%, UNCONFIRMED\n';
    const sonnet = 'Smile, 95%, UNCONFIRMED\nStanding, 70%, UNCONFIRMED\nJoy, 99%, UNCONFIRMED\n';
    const plain = 'Smile: 60, CONFIRMED\r\nWarmth, N/A, CONFIRMED\r\nFear, 80%, UNCONFIRMED\r\n';
    expect(mergeExpressionSidecars(gpt, sonnet, plain)).toBe('Smile, 80%, CONFIRMED\nCuriosity, 65%, UNCONFIRMED\nStanding, 70%, UNCONFIRMED\nWarmth, N/A, CONFIRMED\n');
  });
  it('uses an available physical score when GPT gave none and keeps confirmed AI origin', () => {
    expect(mergeExpressionSidecars('Frontal, N/A, UNCONFIRMED', 'Frontal, 70%, UNCONFIRMED', 'AIGenerated, N/A, CONFIRMED')).toBe('Frontal, 70%, UNCONFIRMED\nAIGenerated, N/A, CONFIRMED\n');
  });
  it('does not silently discard malformed input', () => {
    expect(() => mergeExpressionSidecars('Mystery note', null, null)).toThrow(/Unrecognized line/);
    expect(() => mergeExpressionSidecars('Smile, 101%, UNCONFIRMED', null, null)).toThrow(/Invalid tag/);
  });
  it('keeps every existing tag when the model sidecars are no longer present', () => {
    const text = 'Curiosity, 65%, UNCONFIRMED\nStanding, 70%, UNCONFIRMED\nWarmth, N/A, CONFIRMED\n';
    expect(mergeExpressionSidecars(null, null, text)).toBe(text);
  });
  it('supports each choice for conflicting scores within a GPT assessment', () => {
    const gpt = 'Smile, 80%, UNCONFIRMED\nSmile, 90%, UNCONFIRMED\n';
    expect(mergeExpressionSidecars(gpt, null, null, 'first')).toBe('Smile, 80%, UNCONFIRMED\n');
    expect(mergeExpressionSidecars(gpt, null, null, 'higher')).toBe('Smile, 90%, UNCONFIRMED\n');
    expect(() => mergeExpressionSidecars(gpt, null, null, 'review')).toThrow(/needs review/);
  });
});
