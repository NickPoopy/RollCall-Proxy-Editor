import { describe, expect, it } from 'vitest';
import { moveNet } from './ops';
import { parse } from './parse';

const doc = () =>
  parse(
    [
      '[Combiner Services]',
      'IpShare0=10.0.0.11,2050,1110,-,2050,-,2050,',
      'IpShare1=10.0.0.21,2050,1210,-,2050,-,2050,',
      '[NetNames]',
      '0000=Root',
      '1000=Frames',
      '1100=A',
      '1110=A card',
      '1200=B',
      '1210=B card',
      '1300=C',
      '1500=E',
      '2000=Other',
      '2100=X',
      '',
    ].join('\n'),
  ).doc;

const names = (d: ReturnType<typeof doc>) => d.netNames.map((n) => `${n.addr}=${n.name}`);

describe('moveNet (drag and drop)', () => {
  it('drops into another net at the next free slot, taking children and devices', () => {
    const r = moveNet(doc(), '1100', '2000');
    expect(r.addr).toBe('2200');
    expect(names(r.doc)).toContain('2210=A card');
    expect(r.doc.ipShares[0].net).toBe('2210');
  });

  it('reorders within a parent by shifting the siblings in between', () => {
    // Move A (slot 1) to slot 3: B 2->1, C 3->2, A -> 3.
    const r = moveNet(doc(), '1100', '1000', 3);
    expect(r.shifted).toBe(2);
    expect(names(r.doc).filter((n) => /^1[1-9A-F]00=/.test(n)).sort()).toEqual(['1100=B', '1200=C', '1300=A', '1500=E']);
    expect(r.doc.ipShares.map((s) => s.net)).toEqual(['1310', '1110']);
    // Move C (slot 3) up to slot 1: A 1->2, B 2->3.
    const up = moveNet(doc(), '1300', '1000', 1);
    expect(names(up.doc).filter((n) => /^1[1-9A-F]00=/.test(n)).sort()).toEqual(['1100=C', '1200=A', '1300=B', '1500=E']);
  });

  it('inserts from another parent, rippling only up to the first gap', () => {
    // X into Frames at slot 2: B 2->3, C 3->4, slot 4 was free so E stays at 5.
    const r = moveNet(doc(), '2100', '1000', 2);
    expect(r.addr).toBe('1200');
    expect(names(r.doc).filter((n) => /^1[1-9A-F]00=/.test(n)).sort()).toEqual(['1100=A', '1200=X', '1300=B', '1400=C', '1500=E']);
    expect(r.doc.ipShares[1].net).toBe('1310');
  });

  it('refuses impossible moves', () => {
    expect(() => moveNet(doc(), '1000', '1100')).toThrow(/inside itself/);
    expect(() => moveNet(doc(), '1000', '1110')).toThrow();
    // Moving Frames (3 levels deep) under X would need 5 levels.
    expect(() => moveNet(doc(), '1000', '2100')).toThrow(/levels/);
    expect(moveNet(doc(), '1100', '1000').doc).toEqual(doc());
  });
});
