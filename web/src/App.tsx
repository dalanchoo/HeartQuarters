import { useEffect, useState } from 'react';
import { ProjectsPage } from './ProjectsPage';
import { GuidesPage } from './GuidesPage';
import { ToolsPage } from './ToolsPage';

const TABS = ['Projects', 'Guides', 'Tools'] as const;
type Tab = (typeof TABS)[number];

// The current tab is kept in the address (#Projects, #Guides, #Tools)
// so refreshing the page keeps you where you were.
function tabFromHash(): Tab {
  const name = decodeURIComponent(location.hash.slice(1).split('/')[0]);
  return (TABS as readonly string[]).includes(name) ? (name as Tab) : 'Projects';
}

export function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/icon.png" alt="" />
          HeartQuarters
        </div>
        <nav>
          {TABS.map((t) => (
            <a key={t} href={`#${t}`} className={t === tab ? 'active' : ''}>
              {t}
            </a>
          ))}
        </nav>
      </header>
      <main>
        {tab === 'Projects' && <ProjectsPage />}
        {tab === 'Guides' && <GuidesPage />}
        {tab === 'Tools' && <ToolsPage />}
      </main>
    </div>
  );
}
