import { insertBeforeTrailingBlanks } from './parse';
import { IPSHARE_SECTION, NETNAMES_SECTION, type IpShare, type ProxyDoc, type Section } from './types';

export function formatIpShare(s: IpShare): string {
  const fields = [s.ip1, s.port1, s.net, s.ip2, s.port2, s.ip3, s.port3, ...s.extra];
  return fields.join(',') + (s.trailingComma ? ',' : '');
}

/**
 * Make sure the doc has a place to write NetNames and IpShares. Returns the
 * same doc when nothing needed adding.
 */
export function withPlaceholders(doc: ProxyDoc): ProxyDoc {
  const has = (t: 'netnames' | 'ipshares') => doc.sections.some((s) => s.entries.some((e) => e.type === t));
  const needNet = doc.netNames.length > 0 && !has('netnames');
  const needShare = doc.ipShares.length > 0 && !has('ipshares');
  if (!needNet && !needShare) return doc;

  const sections: Section[] = doc.sections.map((s) => ({ ...s, entries: [...s.entries] }));
  if (needShare) {
    let s = sections.find((x) => x.name === IPSHARE_SECTION);
    if (!s) {
      s = { name: IPSHARE_SECTION, header: `[${IPSHARE_SECTION}]`, entries: [] };
      const firstNamed = sections.findIndex((x) => x.name !== null);
      sections.splice(firstNamed < 0 ? sections.length : firstNamed, 0, s);
    }
    insertBeforeTrailingBlanks(s, { type: 'ipshares' });
  }
  if (needNet) {
    let s = sections.find((x) => x.name === NETNAMES_SECTION);
    if (!s) {
      s = { name: NETNAMES_SECTION, header: `[${NETNAMES_SECTION}]`, entries: [] };
      sections.push(s);
    }
    insertBeforeTrailingBlanks(s, { type: 'netnames' });
  }
  return { ...doc, sections };
}

export function serialize(input: ProxyDoc): string {
  const doc = withPlaceholders(input);
  const out: string[] = [];
  for (const s of doc.sections) {
    if (s.header !== null) out.push(s.header);
    for (const e of s.entries) {
      switch (e.type) {
        case 'kv':
          out.push(`${e.key}=${e.value}`);
          break;
        case 'raw':
          out.push(e.text);
          break;
        case 'ipshares':
          doc.ipShares.forEach((share, i) => out.push(`IpShare${i}=${formatIpShare(share)}`));
          break;
        case 'netnames':
          doc.netNames.forEach((n) => out.push(`${n.addr}=${n.name}`));
          break;
      }
    }
  }
  if (out.length === 0) return '';
  return out.join(doc.eol) + (doc.trailingNewline ? doc.eol : '');
}
