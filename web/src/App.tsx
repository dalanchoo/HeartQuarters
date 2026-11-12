import { useEffect, useState, type ClipboardEvent } from 'react';
import { AiPicker } from './AiPicker';
import { postJson } from './api';

// A page load starts with no old AI conversations (John, 2026-11-12). Done once here, not on every tab change.
void postJson('/api/conversations/forget').catch(() => {});
import { ProjectsPage } from './ProjectsPage';
import { SubstackPage } from './SubstackPage';
import { ExpressionsPage } from './ExpressionsPage';
import { GuidesPage } from './GuidesPage';
import { SkillsPage } from './SkillsPage';
import { ToolsPage } from './ToolsPage';
import { cleanYoutubeLinks } from './cleanYoutubeLinks';

/** Preserve normal paste (including images) unless a recognized YouTube link can be cleaned. */
function cleanPaste(event: ClipboardEvent<HTMLDivElement>) {
  if (event.defaultPrevented || [...event.clipboardData.items].some((item) => item.kind === 'file')) return;
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(target.type))) return;
  if (target.disabled || target.readOnly || document.activeElement !== target) return;
  const original = event.clipboardData.getData('text/plain');
  const cleaned = cleanYoutubeLinks(original);
  if (original !== cleaned && document.execCommand('insertText', false, cleaned)) event.preventDefault();
}

// Each tab has an id (used in the address, e.g. #Videos) and a label.
const TABS = [
  { id: 'Videos', label: 'Video Projects' },
  { id: 'Substack', label: 'Substack' },
  { id: 'Expressions', label: 'Expressions' },
  { id: 'Guides', label: 'Guides' },
  { id: 'Skills', label: 'Skills' },
  { id: 'Tools', label: 'Tools' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// The current tab is kept in the address so refreshing keeps you where you were.
function tabFromHash(): TabId {
  const name = decodeURIComponent(location.hash.slice(1).split('/')[0]);
  if (name === 'Projects') return 'Videos'; // old bookmarks
  return TABS.find((t) => t.id === name)?.id ?? 'Videos';
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app" onPasteCapture={cleanPaste}>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.png" alt="" />
          HeartQuarters
        </div>
        <nav>
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={t.id === tab ? 'active' : ''}>
              {t.label}
            </a>
          ))}
        </nav>
        <AiPicker />
      </header>
      <main>
        {tab === 'Videos' && <ProjectsPage />}
        {tab === 'Substack' && <SubstackPage />}
        {tab === 'Expressions' && <ExpressionsPage />}
        {tab === 'Guides' && <GuidesPage />}
        {tab === 'Skills' && <SkillsPage />}
        {tab === 'Tools' && <ToolsPage />}
      </main>
    </div>
  );
}
