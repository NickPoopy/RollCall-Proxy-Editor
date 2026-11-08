import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inSubtree } from './address';
import { applyOutline, parseOutline } from './bulk';
import { parse } from './parse';
import { BUILTIN_PREFABS, defaultValues, prefabFromBranch, renderPrefab, type Prefab } from './prefabs';
import { evaluate, renderTemplate, TemplateError } from './template';
import { removeSubtree } from './ops';
import type { ProxyDoc } from './types';

const SAMPLE = readFileSync(new URL('../../samples/example-proxy.txt', import.meta.url), 'latin1');
const byId = (id: string) => BUILTIN_PREFABS.find((p) => p.id === id)!;

/** Render a prefab, apply it under parent, and return the doc. */
function add(doc: ProxyDoc, parent: string, p: Prefab, values: Record<string, unknown> = {}) {
  const text = renderPrefab(p, { ...defaultValues(p), ...(values as Record<string, string | number | boolean>) });
  const { rows, errors } = parseOutline(text);
  expect(errors).toEqual([]);
  return applyOutline(doc, parent, rows, { defaultPort: '2050', merge: true }).doc;
}
const snapshot = (doc: ProxyDoc, root: string) => ({
  names: doc.netNames.filter((n) => inSubtree(n.addr, root)).map((n) => `${n.addr}=${n.name}`).sort(),
  shares: doc.ipShares.filter((s) => inSubtree(s.net, root)).map((s) => `${s.net} ${s.ip1} ${s.ip2}`).sort(),
});

describe('template language', () => {
  it('evaluates expressions', () => {
    const v = { a: 3, s: 'MV', ip: '10.0.0.250' };
    expect(evaluate('a*10 + 2', v)).toBe(32);
    expect(evaluate("s + a", v)).toBe('MV3');
    expect(evaluate('pad(a, 3)', v)).toBe('003');
    expect(evaluate('hex(a+7)', v)).toBe('A');
    expect(evaluate('ip(ip, 10)', v)).toBe('10.0.1.4');
    expect(evaluate("ip('-', 10)", v)).toBe('-');
    expect(evaluate('a >= 3 && s == "MV"', v)).toBe(true);
    expect(() => evaluate('nope + 1', v)).toThrow(TemplateError);
  });

  it('renders repeat and if blocks', () => {
    const body = '@repeat i 1..n\nItem {{i}}\n@if i == 2\n\tSecond\n@end\n@end';
    expect(renderTemplate(body, { n: 3 })).toBe('Item 1\nItem 2\n\tSecond\nItem 3');
    expect(() => renderTemplate('@repeat i 1..2\nx', {})).toThrow(/missing @end/);
    expect(() => renderTemplate('{{bad(}}', {})).toThrow(/Line 1/);
  });
});

describe('built-in prefabs reproduce the sample file', () => {
  const doc = parse(SAMPLE).doc;

  it('Multiviewers = IP MVs MV1–MV7', () => {
    let d = doc;
    for (const a of ['2110', '2120', '2130', '2140', '2150', '2160', '2170', '2180']) d = removeSubtree(d, a);
    d = add(d, '2100', byId('builtin-multiviewer'), { count: 7, ip: '10.20.82.10' });
    const want = snapshot(removeSubtree(doc, '2180'), '2100');
    expect(snapshot(d, '2100')).toEqual(want);
  });

  it('MV media ports = MV1–MV7 Port 1–4', () => {
    let d = doc;
    for (const a of ['A410', 'A420', 'A430', 'A440', 'A450', 'A460', 'A470']) d = removeSubtree(d, a);
    d = add(d, 'A400', byId('builtin-mv-media-ports'), { count: 7, ipA: '10.200.80.11', ipB: '10.201.81.10'.replace('10.201', '10.200') });
    expect(snapshot(d, 'A400')).toEqual(snapshot(doc, 'A400'));
  });

  it('IQ frames: F3/F4 cards land in their own slots with the right IPs', () => {
    const d = add(removeSubtree(removeSubtree(doc, 'A130'), 'A140'), 'A100', byId('builtin-iq-frames'), {
      frames: 2, firstFrame: 3, firstCard: 1, lastCard: 4, ipA: '10.200.82.30', ipB: '10.200.83.30',
    });
    expect(snapshot(d, 'A130')).toEqual(snapshot(doc, 'A130'));
    expect(snapshot(d, 'A140')).toEqual(snapshot(doc, 'A140'));
  });
});
describe('prefabFromBranch', () => {
  it('turns MV1 into a reusable block that recreates MV2', () => {
    const doc = parse(SAMPLE).doc;
    const p = prefabFromBranch(doc, '2110');
    expect(p.params.map((x) => [x.key, x.default])).toEqual([
      ['count', 1],
      ['first', 1],
      ['prefix', 'MV'],
      ['net1', '10.20.82'],
      ['step', 10],
    ]);
    const d = add(removeSubtree(doc, '2120'), '2100', p, { first: 2, net1: '10.20.82', step: 10, count: 1 });
    // With first=2 and k=0, IPs are unshifted. Shift by using the IP net: MV2 lives at .20, so use step via count instead.
    expect(d.netNames.some((n) => n.name === 'MV2')).toBe(true);
    const d2 = add(removeSubtree(removeSubtree(doc, '2120'), '2130'), '2100', p, { first: 1, count: 3 });
    // count 3 from MV1: MV1 merges (existing), MV2 and MV3 are new with +10/+20.
    expect(snapshot(d2, '2120')).toEqual(snapshot(doc, '2120'));
    expect(snapshot(d2, '2130')).toEqual(snapshot(doc, '2130'));
  });

  it('keeps child slots', () => {
    const doc = parse(SAMPLE).doc;
    const p = prefabFromBranch(doc, 'A110');
    expect(p.body).toContain('[3] F1 IQUCP25_03');
  });
});
