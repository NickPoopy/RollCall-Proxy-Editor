import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bulkAddChildren, moveNet, removeIpShare, removeSubtree } from './ops';
import { parse } from './parse';
import { serialize } from './serialize';

const SAMPLE = readFileSync(new URL('../../samples/example-proxy.txt', import.meta.url), 'latin1');

/** The IpShare numbers in the order they appear in the text. */
const numbers = (text: string) => [...text.matchAll(/^IpShare(\d+)=/gm)].map((m) => Number(m[1]));
const sequential = (ns: number[]) => ns.every((n, i) => n === i);

describe('IpShare numbering', () => {
  it('stays 0..N with no gaps after deletes, adds and moves', () => {
    let doc = parse(SAMPLE).doc;
    doc = removeIpShare(doc, 5);
    doc = removeSubtree(doc, '2130'); // removes 5 devices from the middle
    doc = bulkAddChildren(doc, '1210', { count: 2, namePattern: 'X {n}', startNumber: 1, device: { ip1: '10.1.1.1', port1: '2050', ip2: '-', port2: '2050', ip3: '-', port3: '2050', step: 1 } }).doc;
    doc = moveNet(doc, '2170', '2100', 1).doc;
    const text = serialize(doc);
    const ns = numbers(text);
    expect(ns.length).toBe(266 - 1 - 5 + 2);
    expect(sequential(ns)).toBe(true);
  });

  it('flags hand-typed gaps and repeats, and serialize fixes them', () => {
    const gappy = SAMPLE.replace('IpShare5=', 'IpShare9=').replace(/IpShare6=.*\r\n/, '');
    const r = parse(gappy);
    const w = r.diagnostics.filter((d) => d.code === 'ipshare-numbering');
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe('warning');
    expect(w[0].message).toContain('IpShare9 but should be IpShare5');
    expect(w[0].line).toBe(12);
    const fixed = serialize(r.doc);
    expect(sequential(numbers(fixed))).toBe(true);
    expect(parse(fixed).diagnostics.some((d) => d.code === 'ipshare-numbering')).toBe(false);
  });

  it('the sample is already in sequence', () => {
    expect(parse(SAMPLE).diagnostics.some((d) => d.code === 'ipshare-numbering')).toBe(false);
  });
});
