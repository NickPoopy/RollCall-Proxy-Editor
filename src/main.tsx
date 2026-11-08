import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { restoreDraft, startDraftAutosave, useStore } from './state/store';
import { NEW_TEMPLATE } from './state/templates';
import './styles.css';

if (!restoreDraft()) useStore.getState().load(NEW_TEMPLATE, { fileName: 'untitled.txt' });
startDraftAutosave();

// Dev-only hook for automated UI tests.
if (import.meta.env.DEV) (window as unknown as { __rpe: typeof useStore }).__rpe = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
