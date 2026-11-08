import { isValidAddr, normAddr } from './address';
import {
  IPSHARE_SECTION,
  NETNAMES_SECTION,
  type Diagnostic,
  type IpShare,
  type LineIndex,
  type ParseResult,
  type ProxyDoc,
  type Section,
} from './types';

const SECTION_RE = /^\s*\[(.*)\]\s*$/;
const IPSHARE_KEY_RE = /^\s*IpShare\d+\s*$/i;

function isBlankOrComment(line: string): boolean {
  const t = line.trim();
  return t === '' || t.startsWith(';') || t.startsWith('#');
}

/** Parse the value part of an IpShare line. Returns an error string on failure. */
export function parseIpShareValue(value: string): IpShare | string {
  const fields = value.split(',').map((f) => f.trim());
  let trailingComma = false;
  if (fields.length > 1 && fields[fields.length - 1] === '') {
    fields.pop();
    trailingComma = true;
  }
  if (fields.length < 7) {
    return `IpShare needs 7 fields (ip1,port1,net,ip2,port2,ip3,port3) but has ${fields.length}`;
  }
  const [ip1, port1, net, ip2, port2, ip3, port3, ...extra] = fields;
  if (!isValidAddr(net)) return `IpShare net "${net}" is not a 4-digit hex address`;
  return { ip1, port1, net: normAddr(net), ip2, port2, ip3, port3, extra, trailingComma };
}

/**
 * Parse a RollCall proxy file. Never throws: anything unexpected is kept
 * as a raw line so the round trip is lossless, and reported as a diagnostic.
 */
export function parse(text: string): ParseResult {
  const eol: ProxyDoc['eol'] = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  let trailingNewline = false;
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
    trailingNewline = true;
  }

  const doc: ProxyDoc = { sections: [], netNames: [], ipShares: [], eol, trailingNewline };
  const diagnostics: Diagnostic[] = [];
  const lineIndex: LineIndex = { netNames: new Map(), ipShares: [] };

  let current: Section = { name: null, header: null, entries: [] };
  doc.sections.push(current);
  let hasNetPlaceholder = false;
  let hasSharePlaceholder = false;
  const misnumbered: { line: number; found: number; expected: number }[] = [];

  lines.forEach((line, i) => {
    const sec = SECTION_RE.exec(line);
    if (sec) {
      current = { name: sec[1].trim(), header: line, entries: [] };
      doc.sections.push(current);
      return;
    }

    if (isBlankOrComment(line)) {
      current.entries.push({ type: 'raw', text: line });
      return;
    }

    const eq = line.indexOf('=');
    if (eq < 0) {
      current.entries.push({ type: 'raw', text: line });
      diagnostics.push({ severity: 'error', line: i, message: `Expected "key=value" but found "${line.trim()}"` });
      return;
    }
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);

    if (current.name === NETNAMES_SECTION) {
      if (!isValidAddr(key.trim())) {
        current.entries.push({ type: 'raw', text: line });
        diagnostics.push({
          severity: 'error',
          line: i,
          message: `NetNames key "${key.trim()}" must be a 4-digit hex address like 1210`,
        });
        return;
      }
      const addr = normAddr(key);
      if (!hasNetPlaceholder) {
        current.entries.push({ type: 'netnames' });
        hasNetPlaceholder = true;
      }
      doc.netNames.push({ addr, name: value });
      const at = lineIndex.netNames.get(addr) ?? [];
      at.push(i);
      lineIndex.netNames.set(addr, at);
      return;
    }

    if (current.name === IPSHARE_SECTION && IPSHARE_KEY_RE.test(key)) {
      const share = parseIpShareValue(value);
      if (typeof share === 'string') {
        current.entries.push({ type: 'raw', text: line });
        diagnostics.push({ severity: 'error', line: i, message: share });
        return;
      }
      if (!hasSharePlaceholder) {
        current.entries.push({ type: 'ipshares' });
        hasSharePlaceholder = true;
      }
      const n = Number(/\d+/.exec(key)![0]);
      if (n !== doc.ipShares.length) misnumbered.push({ line: i, found: n, expected: doc.ipShares.length });
      lineIndex.ipShares.push(i);
      doc.ipShares.push(share);
      return;
    }

    current.entries.push({ type: 'kv', key, value });
  });

  // RollCall needs IpShare0, IpShare1, IpShare2… in order with no gaps. One warning for the first break.
  if (misnumbered.length > 0) {
    const m = misnumbered[0];
    const more = misnumbered.length > 1 ? ` (${misnumbered.length} lines are out of sequence)` : '';
    diagnostics.push({
      severity: 'warning',
      code: 'ipshare-numbering',
      line: m.line,
      message: `IpShare numbers must run 0, 1, 2… with no gaps or repeats, or RollCall won't load the file. This line is IpShare${m.found} but should be IpShare${m.expected}${more}. Use Renumber to fix it.`,
    });
  }

  // Give existing-but-empty sections a placeholder so new entries land there.
  for (const s of doc.sections) {
    if (s.name === NETNAMES_SECTION && !hasNetPlaceholder) {
      insertBeforeTrailingBlanks(s, { type: 'netnames' });
      hasNetPlaceholder = true;
    }
    if (s.name === IPSHARE_SECTION && !hasSharePlaceholder) {
      insertBeforeTrailingBlanks(s, { type: 'ipshares' });
      hasSharePlaceholder = true;
    }
  }

  // Drop the empty preamble so it doesn't clutter the model.
  if (doc.sections[0].entries.length === 0 && doc.sections.length > 1) doc.sections.shift();

  return { doc, diagnostics, lineIndex };
}

export function insertBeforeTrailingBlanks(s: Section, entry: Section['entries'][number]): void {
  let at = s.entries.length;
  while (at > 0) {
    const e = s.entries[at - 1];
    if (e.type === 'raw' && e.text.trim() === '') at--;
    else break;
  }
  s.entries.splice(at, 0, entry);
}
