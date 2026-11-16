import { describe, expect, it } from 'vitest';
import { groupExpressionAttributes } from './expressionAttributes';

describe('expression photo attribute groups', () => {
  it('keeps framing and pose, facial mechanics, expressions and AI provenance distinct', () => {
    const tag = (name: string, confirmed = false) => ({ tag: name, confidence: 80, confirmed });
    const groups = groupExpressionAttributes([tag('Joy'), tag('EyesClosed'), tag('LookAtCamera'), tag('AIGenerated', true), tag('CloseUp', true), tag('Warmth', true)]);
    expect(groups.framing.map(t => t.tag)).toEqual(['CloseUp', 'LookAtCamera']);
    expect(groups.morphology.map(t => t.tag)).toEqual(['EyesClosed']);
    expect(groups.expressions.map(t => t.tag)).toEqual(['Warmth', 'Joy']);
    expect(groups.details.map(t => t.tag)).toEqual(['AIGenerated']);
  });
});
