export function openScriptWindow(editor: HTMLElement, title: string, onReturn: () => void) {
  const source = editor.ownerDocument;
  const popup = source.defaultView?.open('', '_blank', 'popup,width=1000,height=800');
  if (!popup) return null;

  const inline = editor.parentElement!;
  const page = popup.document;
  page.title = title;
  page.documentElement.lang = source.documentElement.lang;
  const base = page.createElement('base');
  base.href = source.baseURI;
  page.head.append(base);
  for (const style of source.querySelectorAll('link[rel="stylesheet"], style')) {
    page.head.append(style.cloneNode(true));
  }
  page.body.className = 'script-window';
  const card = page.createElement('main');
  card.className = 'card';
  page.body.append(card);
  card.append(editor);

  const returnEditor = () => {
    popup.removeEventListener('pagehide', returnEditor);
    // Move the same editor back before its window goes away.
    inline.append(editor);
    onReturn();
  };
  popup.addEventListener('pagehide', returnEditor);

  return {
    focus: () => popup.focus(),
    close: () => {
      returnEditor();
      popup.close();
    },
    dispose: () => {
      popup.removeEventListener('pagehide', returnEditor);
      popup.close();
    },
  };
}
