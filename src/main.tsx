import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { restoreDraft, startDraftAutosave, useStore } from './state/store';
import { NEW_TEMPLATE } from './state/templates';
import { useSchemes } from './state/schemes';
import { applyTheme, useTheme } from './state/theme';

// Set the theme before the first paint so there's no flash of the default colours.
applyTheme(useTheme.getState().theme);
import './styles.css';

if (!restoreDraft()) useStore.getState().load(NEW_TEMPLATE, { fileName: 'untitled.txt' });
startDraftAutosave();
// IP scheme changes affect the L3 checks.
useSchemes.subscribe(() => useStore.getState().revalidate());

// Dev-only hook for automated UI tests.
if (import.meta.env.DEV) (window as unknown as { __rpe: typeof useStore }).__rpe = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
