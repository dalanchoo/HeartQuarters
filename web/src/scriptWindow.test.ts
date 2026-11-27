import { describe, expect, it, vi } from 'vitest';
import { openScriptWindow } from './scriptWindow';

function setup(blocked = false) {
  let parent = 'inline';
  const inline = { append: vi.fn(() => { parent = 'inline'; }) };
  const card = { append: vi.fn(() => { parent = 'popup'; }), className: '' };
  const stylesheet = { cloneNode: vi.fn(() => 'cloned stylesheet') };
  const popup = Object.assign(new EventTarget(), {
    document: {
      title: '',
      documentElement: { lang: '' },
      createElement: vi.fn((tag: string) => tag === 'main' ? card : {}),
      head: { append: vi.fn() },
      body: { append: vi.fn(), className: '' },
    },
    focus: vi.fn(),
    close: vi.fn(),
  });
  const opener = Object.assign(new EventTarget(), { open: vi.fn(() => blocked ? null : popup) });
  const editor = {
    ownerDocument: {
      defaultView: opener,
      documentElement: { lang: 'en' },
      baseURI: 'http://127.0.0.1:4321/',
      querySelectorAll: vi.fn(() => [stylesheet]),
    },
    parentElement: inline,
  };
  const onReturn = vi.fn();
  const handle = openScriptWindow(editor as unknown as HTMLElement, 'Script — 001', onReturn);
  return { handle, editor, inline, opener, popup, card, onReturn, parent: () => parent };
}

describe('script window', () => {
  it('moves the active editor and returns the same node when the window closes', () => {
    const { editor, inline, popup, card, onReturn, parent } = setup();
    expect(popup.document.title).toBe('Script — 001');
    expect(popup.document.head.append).toHaveBeenCalledWith('cloned stylesheet');
    expect(popup.document.body.append).toHaveBeenCalledWith(card);
    expect(card.append).toHaveBeenCalledWith(editor);
    expect(parent()).toBe('popup');
    popup.dispatchEvent(new Event('pagehide'));
    expect(inline.append).toHaveBeenCalledExactlyOnceWith(editor);
    expect(parent()).toBe('inline');
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('supports focusing the window and returning from its button', () => {
    const { handle, popup, onReturn, parent } = setup();
    handle!.focus();
    expect(popup.focus).toHaveBeenCalledOnce();
    handle!.close();
    expect(parent()).toBe('inline');
    expect(popup.close).toHaveBeenCalledOnce();
    popup.dispatchEvent(new Event('pagehide'));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('focuses the same popup when it receives a second open request', () => {
    const { handle, editor, opener, popup } = setup();
    expect(openScriptWindow(editor as unknown as HTMLElement, 'Script — 001', vi.fn())).toBe(handle);
    expect(opener.open).toHaveBeenCalledOnce();
    expect(popup.focus).toHaveBeenCalledOnce();
  });

  it('closes the popup when the parent tab reloads or leaves', () => {
    const { editor, opener, popup, onReturn, inline } = setup();
    opener.dispatchEvent(new Event('pagehide'));
    expect(popup.close).toHaveBeenCalledOnce();
    expect(inline.append).toHaveBeenCalledExactlyOnceWith(editor);
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('closes the window without returning the editor when its section unmounts', () => {
    const { handle, inline, popup, onReturn } = setup();
    handle!.dispose();
    expect(popup.close).toHaveBeenCalledOnce();
    popup.dispatchEvent(new Event('pagehide'));
    expect(inline.append).not.toHaveBeenCalled();
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('leaves the editor in place if the browser blocks the window', () => {
    const { handle, parent, onReturn } = setup(true);
    expect(handle).toBeNull();
    expect(parent()).toBe('inline');
    expect(onReturn).not.toHaveBeenCalled();
  });
});
