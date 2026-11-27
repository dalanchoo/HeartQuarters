const toggles = ['bold', 'italic', 'underline', 'strikeThrough', 'insertOrderedList', 'insertUnorderedList'] as const;

export const defaultScriptFormatting = { blockTag: 'P', active: [] as (typeof toggles)[number][] };

export function readScriptFormatting(editor: HTMLElement) {
  const page = editor.ownerDocument;
  const selection = page.getSelection();
  const anchor = selection?.anchorNode;
  if (!anchor || !editor.contains(anchor) || !editor.contains(selection.focusNode)) {
    return defaultScriptFormatting;
  }

  const element = anchor.nodeType === 1 ? anchor as Element : anchor.parentElement;
  const block = element?.closest('h1, h2, h3, p');
  const quote = element?.closest('blockquote');
  return {
    blockTag: quote && editor.contains(quote) ? 'BLOCKQUOTE' : block && editor.contains(block) ? block.tagName : 'P',
    active: toggles.filter(command => page.queryCommandState(command)),
  };
}
