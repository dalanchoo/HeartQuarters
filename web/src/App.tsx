import { Component, useEffect, useState, type ClipboardEvent, type ReactNode } from 'react';
import { AiPicker } from './AiPicker';
import { QuotaBadge } from './youtubeQuota';
import { postJson } from './api';

// A page load starts with no old AI conversations (John, 2026-11-12). Done once here, not on every tab change.
void postJson('/api/conversations/forget').catch(() => {});
import { IdeasPage } from './IdeasPage';
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
  { id: 'Ideas', label: 'Ideas' },
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
  let name = '';
  try {
    name = decodeURIComponent(location.hash.slice(1).split('/')[0]);
  } catch {
    return 'Videos';
  }
  if (name === 'Projects') return 'Videos'; // old bookmarks
  return TABS.find((t) => t.id === name)?.id ?? 'Videos';
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-box" style={{ margin: '1rem' }}>
        <h2>Something Went Wrong</h2>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>Try Again</button>
      </div>
    );
  }
}

// Each tab remembers where it was (John, 2026-11-14): its last address (e.g. #Videos/005 - ...), so its button goes
// back there, and its page stays loaded but hidden after the first visit, so open cards, scroll position and
// choices made on it are still there when he comes back. Kept for this browser tab only.
const LAST_PLACES = 'hq-last-places';

function loadPlaces(): Partial<Record<TabId, string>> {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_PLACES) ?? '{}') as Partial<Record<TabId, string>>;
  } catch {
    return {};
  }
}

export function App() {
  const [tab, setTab] = useState<TabId>(tabFromHash);
  const [places, setPlaces] = useState(loadPlaces);
  const [visited, setVisited] = useState<TabId[]>(() => [tabFromHash()]);

  useEffect(() => {
    const remember = () => {
      const now = tabFromHash();
      setTab(now);
      setVisited((v) => (v.includes(now) ? v : [...v, now]));
      setPlaces((p) => {
        const next = { ...p, [now]: location.hash || `#${now}` };
        try {
          sessionStorage.setItem(LAST_PLACES, JSON.stringify(next));
        } catch {
          /* fine: it's only remembered while the page is open */
        }
        return next;
      });
    };
    remember();
    window.addEventListener('hashchange', remember);
    return () => window.removeEventListener('hashchange', remember);
  }, []);

  const page = (id: TabId, element: ReactNode) =>
    visited.includes(id) ? (
      <div key={id} className="tab-page" hidden={tab !== id}>
        {element}
      </div>
    ) : null;

  return (
    <div className="app" onPasteCapture={cleanPaste}>
      <header className="topbar">
        <div className="brand">
          <img src="/icon.png" alt="" />
          HeartQuarters
        </div>
        <nav>
          {TABS.map((t) => (
            <a key={t.id} href={places[t.id] ?? `#${t.id}`} className={t.id === tab ? 'active' : ''}>
              {t.label}
            </a>
          ))}
        </nav>
        <QuotaBadge />
        <AiPicker />
      </header>
      <main>
        <ErrorBoundary>
          {page('Ideas', <IdeasPage />)}
          {page('Videos', <ProjectsPage />)}
          {page('Substack', <SubstackPage />)}
          {page('Expressions', <ExpressionsPage />)}
          {page('Guides', <GuidesPage />)}
          {page('Skills', <SkillsPage />)}
          {page('Tools', <ToolsPage />)}
        </ErrorBoundary>
      </main>
    </div>
  );
}
