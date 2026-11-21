import { StrictMode } from 'react';
import { restoreSidebarWidth } from './SidebarResizer';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

restoreSidebarWidth(); // the left column's width chosen last time
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
