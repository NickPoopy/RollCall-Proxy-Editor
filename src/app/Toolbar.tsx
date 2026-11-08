import { useCallback, useEffect } from 'react';
import { sortNetNames } from '../model/ops';
import { openFile, saveFile } from '../state/files';
import { useStore } from '../state/store';
import { useSchemes } from '../state/schemes';
import { THEMES, useTheme, type ThemeId } from '../state/theme';
import { EXAMPLE_TEXT, NEW_TEMPLATE } from '../state/templates';

const REPO_URL = 'https://github.com/NickPoopy/RollCall-Proxy-Editor';

export function useFileActions() {
  const confirmDiscard = useCallback(() => {
    const s = useStore.getState();
    return s.text === s.savedText || window.confirm('Discard unsaved changes?');
  }, []);

  const save = useCallback(async (as: boolean) => {
    // Never save a file with IpShare gaps; RollCall won't load it.
    const renumbered = useStore.getState().renumberIpShares();
    const s = useStore.getState();
    try {
      const r = await saveFile(s.text, s.encoding, s.fileName, as ? null : s.fileHandle);
      if (r) {
        // IP schemes are kept per file name; carry them over on Save as.
        useSchemes.getState().rename(s.fileName, r.fileName);
        s.markSaved(r);
        s.showToast(renumbered ? `Renumbered IpShares to 0–${s.doc.ipShares.length - 1} and saved ${r.fileName}` : `Saved ${r.fileName}`, 'info');
      }
    } catch (e) {
      s.showToast(`Could not save: ${(e as Error).message}`);
    }
  }, []);

  const open = useCallback(async () => {
    if (!confirmDiscard()) return;
    try {
      const f = await openFile();
      if (f) useStore.getState().load(f.text, f);
    } catch (e) {
      useStore.getState().showToast(`Could not open: ${(e as Error).message}`);
    }
  }, [confirmDiscard]);

  const newFile = useCallback(() => {
    if (confirmDiscard()) useStore.getState().load(NEW_TEMPLATE, { fileName: 'untitled.txt' });
  }, [confirmDiscard]);

  const loadExample = useCallback(() => {
    if (confirmDiscard()) useStore.getState().load(EXAMPLE_TEXT, { fileName: 'example-proxy.txt' });
  }, [confirmDiscard]);

  return { confirmDiscard, save, open, newFile, loadExample };
}

function inTextField(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.closest('.cm-editor') !== null);
}

export function Toolbar() {
  const { save, open, newFile, loadExample } = useFileActions();
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.text !== s.savedText);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { undo, redo, apply } = useStore.getState();
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 's') {
        e.preventDefault();
        void save(e.shiftKey);
      } else if (k === 'o') {
        e.preventDefault();
        void open();
      } else if (!inTextField() && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (!inTextField() && k === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, open, undo, redo]);

  return (
    <header className="toolbar">
      <div className="brand">
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="var(--globe)" />
          <path d="M1 8h14M8 1c-3 3-3 11 0 14M8 1c3 3 3 11 0 14" stroke="#dfe" fill="none" strokeWidth="1" />
        </svg>
        <span>RollCall Proxy Editor</span>
        <span className="version">v{__APP_VERSION__}</span>
      </div>
      <div className="toolbar-group">
        <button onClick={newFile} title="Start a new proxy file">New</button>
        <button onClick={() => void open()} title="Open a proxy file (Ctrl+O)">Open…</button>
        <button onClick={() => void save(false)} title="Save (Ctrl+S)">Save</button>
        <button onClick={() => void save(true)} title="Save as a new file (Ctrl+Shift+S)">Save as…</button>
        <button onClick={loadExample} title="Load the bundled example file">Example</button>
      </div>
      <div className="toolbar-group">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z outside the text pane)">Undo</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
        <button onClick={() => apply(sortNetNames)} title="Sort [NetNames] entries by address">Sort NetNames</button>
      </div>
      <div className="file-name" title={fileName}>
        {fileName}
        {dirty && <span className="dirty" title="Unsaved changes">●</span>}
      </div>
      <label className="theme-picker" title="Colour theme">
        <span className="muted">Theme</span>
        <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)} aria-label="Colour theme">
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <a className="help" href={REPO_URL} target="_blank" rel="noreferrer">Help</a>
    </header>
  );
}
