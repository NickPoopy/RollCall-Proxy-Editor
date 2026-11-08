import { useStore } from '../../state/store';

const ICON = { error: '⛔', warning: '⚠', info: 'ℹ' } as const;

export function IssuesTab({ onShowTree }: { onShowTree: () => void }) {
  const issues = useStore((s) => s.issues);
  const parseErrors = useStore((s) => s.parseErrors);
  const all = [...parseErrors, ...issues];
  const order = { error: 0, warning: 1, info: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);

  if (all.length === 0) return <p className="empty">No issues found. 🎉</p>;

  return (
    <ul className="issue-list">
      {all.map((d, k) => (
        <li
          key={k}
          className={`sev-${d.severity}${d.addr ? ' clickable' : ''}`}
          onClick={() => {
            if (!d.addr) return;
            useStore.getState().select(d.addr, 'editor');
            onShowTree();
          }}
        >
          <span className="issue-icon" aria-label={d.severity}>{ICON[d.severity]}</span>
          <span>{d.message}</span>
          {d.code === 'ipshare-numbering' && (
            <button
              className="small"
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().renumberIpShares();
              }}
            >
              Renumber
            </button>
          )}
          {d.line !== undefined && <span className="muted mono small">line {d.line + 1}</span>}
        </li>
      ))}
    </ul>
  );
}
