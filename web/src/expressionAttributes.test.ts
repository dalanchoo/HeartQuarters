import { describe, expect, it } from 'vitest';
import { allThreeAIsAgreed, groupExpressionAttributes, threeAiDisagreements } from './expressionAttributes';

describe('expression photo attribute groups', () => {
  it('keeps framing, pose, facial mechanics, expressions and AI provenance distinct', () => {
    const tag = (name: string, confirmed = false) => ({ tag: name, confidence: 80, confirmed });
    const groups = groupExpressionAttributes([tag('Joy'), tag('EyesClosed'), tag('LookAtCamera'), tag('AIGenerated', true), tag('CloseUp', true), tag('Warmth', true)]);
    expect(groups.framing.map(t => t.tag)).toEqual(['CloseUp']);
    expect(groups.pose.map(t => t.tag)).toEqual(['LookAtCamera']);
    expect(groups.morphology.map(t => t.tag)).toEqual(['EyesClosed']);
    expect(groups.expressions.map(t => t.tag)).toEqual(['Warmth', 'Joy']);
    expect(groups.details.map(t => t.tag)).toEqual(['AIGenerated']);
  });

  it('finds attributes all three AIs agreed on that were disconfirmed or removed', () => {
    expect(allThreeAIsAgreed({ assessments: { claude: 80, codex: 75, gemini: 90 } })).toBe(true);
    expect(allThreeAIsAgreed({ assessments: { claude: 80, codex: 74, gemini: 90 } })).toBe(false);
    const conflicts = threeAiDisagreements({
      tags: [
        { tag: 'Smile', confidence: 90, confirmed: false, disconfirmed: true, assessments: { claude: 90, codex: 85, gemini: 80 } },
        { tag: 'Frown', confidence: 80, confirmed: false, disconfirmed: true, assessments: { claude: 80 } },
      ],
      removedTags: [
        { tag: 'LipPress', confidence: 88, confirmed: false, removed: true, assessments: { claude: 88, codex: 82, gemini: 79 } },
      ],
    });
    expect(conflicts.map(c => c.tag)).toEqual(['Smile', 'LipPress']);
  });
});
