import { describe, expect, it, vi } from 'vitest';
import { readScriptFormatting } from './scriptFormatting';

function editorSelection({ tag = 'P', quoted = false, outside = false, active = [] as string[] } = {}) {
  const block = { tagName: tag };
  const quote = quoted ? {} : null;
  const anchor = { nodeType: 3, parentElement: { closest: (selector: string) => selector === 'blockquote' ? quote : block } };
  const focus = outside ? {} : anchor;
  const queryCommandState = vi.fn((command: string) => active.includes(command));
  const editor = {
    ownerDocument: { getSelection: () => ({ anchorNode: anchor, focusNode: focus }), queryCommandState },
    contains: (node: unknown) => node === anchor || node === block || (quote !== null && node === quote),
  } as unknown as HTMLElement;
  return { editor, queryCommandState };
}

describe('script formatting', () => {
  it('reads the active inline styles and list type from the editor document', () => {
    const { editor } = editorSelection({ tag: 'H2', active: ['bold', 'underline', 'insertOrderedList'] });
    expect(readScriptFormatting(editor)).toEqual({ blockTag: 'H2', active: ['bold', 'underline', 'insertOrderedList'] });
  });

  it('recognizes a paragraph inside a quote', () => {
    const { editor } = editorSelection({ quoted: true });
    expect(readScriptFormatting(editor).blockTag).toBe('BLOCKQUOTE');
  });

  it('clears the formatting indicators when a selection extends outside the editor', () => {
    const { editor, queryCommandState } = editorSelection({ outside: true, active: ['bold'] });
    expect(readScriptFormatting(editor)).toEqual({ blockTag: 'P', active: [] });
    expect(queryCommandState).not.toHaveBeenCalled();
  });
});
