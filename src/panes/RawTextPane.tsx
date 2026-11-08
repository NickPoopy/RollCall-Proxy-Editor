import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { linter, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { parse } from '../model/parse';
import { validate } from '../model/validate';
import { useStore } from '../state/store';

// ---- Highlight for the lines of the selected net ----
const setHighlight = StateEffect.define<number[]>();
const highlightLine = Decoration.line({ class: 'cm-selected-net' });

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setHighlight)) {
        const doc = tr.state.doc;
        const ranges = [...new Set(e.value)]
          .filter((l) => l >= 0 && l < doc.lines)
          .sort((a, b) => a - b)
          .map((l) => highlightLine.range(doc.line(l + 1).from));
        deco = Decoration.set(ranges);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Lint: parse errors plus validation issues, straight from the editor text ----
const proxyLinter = linter(
  (view) => {
    const text = view.state.doc.toString();
    const r = parse(text);
    const diags = r.diagnostics.some((d) => d.severity === 'error') ? r.diagnostics : [...r.diagnostics, ...validate(r.doc, r.lineIndex)];
    const out: CmDiagnostic[] = [];
    for (const d of diags) {
      const line = d.line ?? (d.addr ? r.lineIndex.netNames.get(d.addr)?.[0] : undefined);
      if (line === undefined || line >= view.state.doc.lines) continue;
      const l = view.state.doc.line(line + 1);
      out.push({ from: l.from, to: l.to, severity: d.severity, message: d.message });
    }
    return out;
  },
  { delay: 300 },
);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px' },
  '.cm-scroller': { fontFamily: 'var(--mono)' },
  '.cm-selected-net': { backgroundColor: 'var(--sel-line)' },
});

export function RawTextPane() {
  const text = useStore((s) => s.text);
  const selected = useStore((s) => s.selected);
  const selectOrigin = useStore((s) => s.selectOrigin);
  const lineIndex = useStore((s) => s.lineIndex);
  const parseErrors = useStore((s) => s.parseErrors);
  const ref = useRef<ReactCodeMirrorRef>(null);
  const editorText = useMemo(() => text.replace(/\r\n/g, '\n'), [text]);

  const extensions = useMemo<Extension[]>(
    () => [
      StreamLanguage.define(properties),
      lintGutter(),
      proxyLinter,
      highlightField,
      theme,
      EditorView.updateListener.of((u) => {
        if (import.meta.env.DEV) (window as unknown as { __rpeView: EditorView }).__rpeView = u.view;
        if (!u.selectionSet || !u.view.hasFocus) return;
        const line = u.state.doc.lineAt(u.state.selection.main.head).number - 1;
        const addr = useStore.getState().lineToAddr.get(line);
        if (addr) useStore.getState().select(addr, 'text');
      }),
    ],
    [],
  );

  // Highlight and scroll to the selected net's lines.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    const lines: number[] = [];
    if (selected) {
      lines.push(...(lineIndex.netNames.get(selected) ?? []));
      const { doc, parseErrors: errs } = useStore.getState();
      if (errs.length === 0) {
        doc.ipShares.forEach((s, i) => {
          if (s.net === selected && lineIndex.ipShares[i] !== undefined) lines.push(lineIndex.ipShares[i]);
        });
      }
    }
    const effects: StateEffect<unknown>[] = [setHighlight.of(lines)];
    if (selectOrigin !== 'text' && lines.length > 0 && lines[0] < view.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(view.state.doc.line(lines[0] + 1).from, { y: 'center' }));
    }
    view.dispatch({ effects });
  }, [selected, selectOrigin, lineIndex, text]);

  return (
    <section className="pane">
      <div className="pane-header">
        <h2>Raw text</h2>
        {parseErrors.length > 0 && (
          <span className="badge badge-error" title={parseErrors.map((e) => `Line ${(e.line ?? 0) + 1}: ${e.message}`).join('\n')}>
            {parseErrors.length} error{parseErrors.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="pane-body cm-host">
        <CodeMirror
          ref={ref}
          value={editorText}
          height="100%"
          theme="dark"
          extensions={extensions}
          onChange={(v) => {
            // CodeMirror always uses LF internally; keep the file's own line endings in the store.
            const crlf = useStore.getState().doc.eol === '\r\n';
            useStore.getState().setText(crlf ? v.replace(/\n/g, '\r\n') : v);
          }}
          basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: false }}
        />
      </div>
    </section>
  );
}
