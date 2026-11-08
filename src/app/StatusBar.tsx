import { useStore } from '../state/store';

export function StatusBar() {
  const doc = useStore((s) => s.doc);
  const parseErrors = useStore((s) => s.parseErrors.length);
  const issues = useStore((s) => s.issues);
  const encoding = useStore((s) => s.encoding);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  return (
    <footer className="statusbar">
      <span>{doc.netNames.length} nets</span>
      <span>{doc.ipShares.length} devices</span>
      {parseErrors > 0 ? (
        <span className="sev-error">⚠ {parseErrors} text error{parseErrors > 1 ? 's' : ''}. The editor and preview show the last valid version.</span>
      ) : (
        <>
          <span className={errors ? 'sev-error' : ''}>{errors} errors</span>
          <span className={warnings ? 'sev-warning' : ''}>{warnings} warnings</span>
        </>
      )}
      <span className="spacer" />
      <span>{doc.eol === '\r\n' ? 'CRLF' : 'LF'}</span>
      <span>{encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'}</span>
    </footer>
  );
}
