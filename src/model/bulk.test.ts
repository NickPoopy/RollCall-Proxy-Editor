import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inSubtree } from './address';
import { applyOutline, applyRenameRules, cloneSubtree, exportOutline, parseOutline, shiftOctet, suggestRename } from './bulk';
import { removeSubtree } from './ops';
import { parse } from './parse';
import { serialize } from './serialize';
import { buildTree, labelOf } from './tree';

const MV = [
  '[Combiner Services]',
  'IpShare0=10.10.82.10,2050,2111,-,2050,-,2050,',
  'IpShare1=10.10.82.11,2050,2112,-,2050,-,2050,',
  'IpShare2=10.10.82.12,2050,2113,-,2050,-,2050,',
  'IpShare3=10.10.82.13,2050,2114,-,2050,-,2050,',
  'IpShare4=10.10.82.14,2050,2115,-,2050,-,2050,',
  'IpShare5=10.9.9.9,2050,3111,-,2050,-,2050,',
  '[NetNames]',
  '0000=Root',
  '2000=Multiviewers',
  '2100=IP MVs',
  '2110=MV1',
  '2111=MV Control',
  '2112=IP Control Port 1',
  '2113=IP Control Port 2',
  '2114=IP Control Port 3',
  '2115=IP Control Port 4',
  '3000=Routers',
  '3100=IPR',
  '3110=IPRA',
  '3111=IPRA A',
  '',
].join('\n');

const SAMPLE = readFileSync(new URL('../../samples/example-proxy.txt', import.meta.url), 'latin1');

describe('cloneSubtree', () => {
  it('stamps out MV1 three times with shifted IPs', () => {
    const doc = parse(MV).doc;
    const s = suggestRename('MV1')!;
    const r = cloneSubtree(doc, '2110', { copies: 3, startNumber: s.next, renameRules: [s.rule], ip: { octet: 4, step: 10 } });
    expect(r.copies.map((c) => [c.root, c.name, c.nets, c.devices, c.firstIp])).toEqual([
      ['2120', 'MV2', 6, 5, '10.10.82.20'],
      ['2130', 'MV3', 6, 5, '10.10.82.30'],
      ['2140', 'MV4', 6, 5, '10.10.82.40'],
    ]);
    const tree = buildTree(r.doc);
    expect(tree.byAddr.get('2140')!.children.map(labelOf)).toEqual(['MV Control', 'IP Control Port 1', 'IP Control Port 2', 'IP Control Port 3', 'IP Control Port 4']);
    expect(r.doc.ipShares.filter((x) => inSubtree(x.net, '2130')).map((x) => x.ip1)).toEqual([
      '10.10.82.30', '10.10.82.31', '10.10.82.32', '10.10.82.33', '10.10.82.34',
    ]);
    // New lines are grouped right after the source block, before Routers.
    const text = serialize(r.doc);
    expect(text.indexOf('2145=IP Control Port 4')).toBeLessThan(text.indexOf('3000=Routers'));
    expect(text.indexOf('2145,-')).toBeLessThan(text.indexOf('10.9.9.9'));
  });

  it('renames children with extra rules and pads numbers', () => {
    expect(suggestRename('Frame 01')).toEqual({ rule: { find: 'Frame 01', replace: 'Frame {n:2}' }, next: 2 });
    expect(suggestRename('Routers')).toBeNull();
    const rules = [
      { find: 'Frame 01', replace: 'Frame {n:2}' },
      { find: 'F1 ', replace: 'F{n} ' },
    ];
    expect(applyRenameRules('F1 IQUCP25_03', rules, 7)).toBe('F7 IQUCP25_03');
    expect(applyRenameRules('Frame 01', rules, 7)).toBe('Frame 07');
  });

  it('refills deleted MV2–MV7 in the real sample', () => {
    let doc = parse(SAMPLE).doc;
    for (const a of ['2120', '2130', '2140', '2150', '2160', '2170']) doc = removeSubtree(doc, a);
    const r = cloneSubtree(doc, '2110', { copies: 6, startNumber: 2, renameRules: [{ find: 'MV1', replace: 'MV{n}' }], ip: { octet: 4, step: 10 } });
    expect(r.copies.map((c) => c.root)).toEqual(['2120', '2130', '2140', '2150', '2160', '2170']);
    const orig = parse(SAMPLE).doc;
    const share = (d: typeof doc, net: string) => d.ipShares.find((s) => s.net === net)!.ip1;
    for (const net of ['2121', '2155', '2175']) expect(share(r.doc, net)).toBe(share(orig, net));
  });

  it('refuses when out of slots or octets', () => {
    const doc = parse(MV).doc;
    expect(() => cloneSubtree(doc, '2110', { copies: 15, startNumber: 2, renameRules: [], ip: { octet: 4, step: 0 } })).toThrow(/free slot/);
    expect(() => cloneSubtree(doc, '2110', { copies: 3, startNumber: 2, renameRules: [], ip: { octet: 4, step: 100 } })).toThrow(/0–255/);
    expect(shiftOctet('10.10.82.10', 3, 1)).toBe('10.10.83.10');
    expect(shiftOctet('-', 4, 5)).toBe('-');
  });
});

describe('parseOutline', () => {
  it('reads tabs, spaces, @ syntax, Excel-style cells and ip:port', () => {
    const { rows, errors } = parseOutline(
      [
        'Kahuna',
        '\tKahuna 1',
        '\t\tKahuna Frame 1\t10.10.85.10\t\t',
        '\t\tMAV1_1',
        '  Kahuna 2',
        '    Kahuna Frame 2 @ 10.10.85.11:2051, -, 10.20.85.11',
        '    Spare 10.1.1.1',
        '# comment',
        '',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.depth, r.name])).toEqual([
      [0, 'Kahuna'],
      [1, 'Kahuna 1'],
      [2, 'Kahuna Frame 1'],
      [2, 'MAV1_1'],
      [1, 'Kahuna 2'],
      [2, 'Kahuna Frame 2'],
      [2, 'Spare'],
    ]);
    expect(rows[2].addrs).toEqual([{ ip: '10.10.85.10', port: undefined }]);
    expect(rows[5].addrs).toEqual([{ ip: '10.10.85.11', port: '2051' }, null, { ip: '10.20.85.11', port: undefined }]);
    expect(rows[6].addrs).toEqual([{ ip: '10.1.1.1', port: undefined }]);
  });

  it('reports bad lines with line numbers', () => {
    const { rows, errors } = parseOutline('A\n\t\t\tB\nC\t999.1.1.1\nD @ -, 10.0.0.1');
    expect(rows.map((r) => r.name)).toEqual(['A']);
    expect(errors.map((e) => e.line)).toEqual([1, 2, 3]);
  });

  it('strips a common indent', () => {
    expect(parseOutline('\t\tA\n\t\t\tB').rows.map((r) => r.depth)).toEqual([0, 1]);
  });
});

describe('applyOutline / exportOutline', () => {
  it('merges into existing nets and fills free slots', () => {
    const doc = parse(MV).doc;
    const { rows } = parseOutline('Multiviewers\n\tIP MVs\n\t\tMV2\n\t\t\tMV Control\t10.10.82.20\nAudio\n\tDesk\t10.5.5.5:2060');
    const r = applyOutline(doc, '0000', rows, { defaultPort: '2050', merge: true });
    expect(r.plan.map((p) => [p.addr, p.status, p.device?.ip ?? null])).toEqual([
      ['2000', 'existing', null],
      ['2100', 'existing', null],
      ['2120', 'new', null],
      ['2121', 'new', '10.10.82.20'],
      ['1000', 'new', null],
      ['1100', 'new', '10.5.5.5'],
    ]);
    expect(r.doc.ipShares.at(-1)).toMatchObject({ net: '1100', port1: '2060', ip2: '-', port2: '2050' });
    // Without merge, a second Multiviewers is created.
    const r2 = applyOutline(doc, '0000', rows.slice(0, 1), { defaultPort: '2050', merge: false });
    expect(r2.plan[0].addr).toBe('1000');
  });

  it('refuses outlines deeper than 4 levels', () => {
    const { rows } = parseOutline('a\n\tb\n\t\tc');
    expect(() => applyOutline(parse(MV).doc, '2110', rows, { defaultPort: '2050', merge: true })).toThrow(/line 2/);
  });

  it('round-trips a branch through export and re-import', () => {
    const doc = parse(SAMPLE).doc;
    const text = exportOutline(doc, '2110');
    expect(text.split('\n')[0]).toBe('MV1');
    expect(text.split('\n')[1]).toBe('\tMV Control\t10.20.82.10');
    const empty = parse('[Combiner Services]\n[NetNames]\n0000=X\n').doc;
    const r = applyOutline(empty, '0000', parseOutline(text).rows, { defaultPort: '2050', merge: true });
    const names = (d: typeof doc, root: string) => d.netNames.filter((n) => inSubtree(n.addr, root)).map((n) => n.name).sort();
    expect(names(r.doc, '1000')).toEqual(names(doc, '2110'));
    expect(r.doc.ipShares.map((s) => s.ip1)).toEqual(doc.ipShares.filter((s) => inSubtree(s.net, '2110')).map((s) => s.ip1));
  });
});
