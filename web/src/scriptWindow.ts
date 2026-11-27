interface ScriptWindow {
  focus: () => void;
  close: () => void;
  dispose: () => void;
}

const openWindows = new WeakMap<HTMLElement, ScriptWindow>();

export function openScriptWindow(editor: HTMLElement, title: string, onReturn: () => void) {
  const existing = openWindows.get(editor);
  if (existing) {
    existing.focus();
    return existing;
  }

  const source = editor.ownerDocument;
  const opener = source.defaultView;
  if (!opener) return null;
  const popup = opener.open('', '_blank', 'popup,width=1000,height=800');
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

  const detach = () => {
    if (openWindows.get(editor) !== handle) return false;
    openWindows.delete(editor);
    popup.removeEventListener('pagehide', returnEditor);
    opener.removeEventListener('pagehide', close);
    return true;
  };
  const returnEditor = () => {
    if (!detach()) return false;
    // Move the same editor back before its window goes away.
    inline.append(editor);
    onReturn();
    return true;
  };
  const close = () => {
    if (returnEditor()) popup.close();
  };
  const handle: ScriptWindow = {
    focus: () => popup.focus(),
    close,
    dispose: () => {
      if (detach()) popup.close();
    },
  };
  openWindows.set(editor, handle);
  opener.addEventListener('pagehide', close);
  popup.addEventListener('pagehide', returnEditor);
  return handle;
}
