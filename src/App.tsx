import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Toolbar, useFileActions } from './app/Toolbar';
import { StatusBar } from './app/StatusBar';
import { RawTextPane } from './panes/RawTextPane';
import { EditorPane } from './panes/EditorPane';
import { PreviewPane } from './panes/PreviewPane';
import { useStore } from './state/store';
import { readFile } from './state/files';

export default function App() {
  const toast = useStore((s) => s.toast);
  const { confirmDiscard } = useFileActions();
  const [dragging, setDragging] = useState(false);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useStore.getState();
      if (s.text !== s.savedText) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file || !confirmDiscard()) return;
    const f = await readFile(file);
    useStore.getState().load(f.text, f);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Toolbar />
      <PanelGroup direction="horizontal" autoSaveId="rpe.panes" className="panes">
        <Panel defaultSize={34} minSize={15}>
          <RawTextPane />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={36} minSize={20}>
          <EditorPane />
        </Panel>
        <PanelResizeHandle className="resize-handle" />
        <Panel defaultSize={30} minSize={15}>
          <PreviewPane />
        </Panel>
      </PanelGroup>
      <StatusBar />
      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status" onClick={() => useStore.setState({ toast: null })}>
          {toast.message}
        </div>
      )}
      {dragging && <div className="drop-overlay">Drop a proxy file to open it</div>}
    </div>
  );
}
