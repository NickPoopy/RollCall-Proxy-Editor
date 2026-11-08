import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { childDigit, depthOf, displayAddr, parentOf, skipsLevel } from './address';
import { parse } from './parse';
import { serialize } from './serialize';
import { buildTree, labelOf } from './tree';
import { validate } from './validate';
import {
  addChild,
  addIpShare,
  bulkAddChildren,
  formatPattern,
  incrementIp,
  moveSubtree,
  removeSubtree,
  setNetName,
  shiftNet,
  sortNetNames,
} from './ops';

const SAMPLE = readFileSync(new URL('../../samples/example-proxy.txt', import.meta.url), 'latin1');
const PRIVATE = new URL('../../samples/private/Proxy-Template.txt', import.meta.url);

describe('address math', () => {
  it('computes parent, digit and RollCall display address', () => {
    expect(parentOf('1210')).toBe('1200');
    expect(childDigit('1210')).toBe(1);
    expect(displayAddr('1210')).toBe('1200:01:00');
    expect(displayAddr('1000')).toBe('0000:01:00');
    expect(displayAddr('A000')).toBe('0000:0A:00');
    expect(displayAddr('121B')).toBe('1210:0B:00');
    expect(parentOf('0000')).toBeNull();
    expect(depthOf('1211')).toBe(4);
    expect(skipsLevel('1010')).toBe(true);
    expect(skipsLevel('1200')).toBe(false);
  });
});

describe('parse / serialize', () => {
  it('round-trips the sample byte-for-byte', () => {
    const { doc, diagnostics } = parse(SAMPLE);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(serialize(doc)).toBe(SAMPLE);
  });

  it.runIf(existsSync(PRIVATE))('round-trips the private original byte-for-byte', () => {
    const text = readFileSync(PRIVATE, 'latin1');
    expect(serialize(parse(text).doc)).toBe(text);
  });

  it('reads structure from the sample', () => {
    const { doc, lineIndex } = parse(SAMPLE);
    expect(doc.eol).toBe('\r\n');
    expect(doc.ipShares).toHaveLength(266);
    expect(doc.ipShares[0]).toMatchObject({ ip1: '10.200.82.12', port1: '2050', net: 'A113', ip2: '10.200.83.12', ip3: '-' });
    expect(doc.netNames.find((n) => n.addr === '1210')?.name).toBe('Video');
    expect(lineIndex.ipShares[0]).toBe(7);
  });

  it('reports bad lines as errors and keeps them', () => {
    const text = '[NetNames]\nZZZZ=Bad\n1000=Good\n[Combiner Services]\nIpShare0=1.2.3.4,2050\n';
    const { doc, diagnostics } = parse(text);
    expect(diagnostics.map((d) => d.line)).toEqual([1, 4]);
    expect(doc.netNames).toEqual([{ addr: '1000', name: 'Good' }]);
    expect(serialize(doc)).toBe(text);
  });

  it('creates sections when adding to an empty file', () => {
    let doc = parse('').doc;
    doc = addChild(doc, '0000', 'Frames').doc;
    doc = addIpShare(doc, '1000', { ip1: '10.0.0.1' });
    expect(serialize(doc)).toBe('[Combiner Services]\nIpShare0=10.0.0.1,2050,1000,-,2050,-,2050,\n[NetNames]\n1000=Frames');
  });
});

describe('tree', () => {
  it('matches the RollCall screenshot structure', () => {
    const tree = buildTree(parse(SAMPLE).doc);
    expect(tree.root.children.map(labelOf)).toEqual([
      'IQ Frames',
      'Multiviewers',
      'Routers',
      'Audio Processing',
      'Kahuna',
      'KudosPro',
      'Media Ports',
    ]);
    const mv1 = tree.byAddr.get('2110')!;
    expect(mv1.children.map(labelOf)).toEqual(['MV Control', 'IP Control Port 1', 'IP Control Port 2', 'IP Control Port 3', 'IP Control Port 4']);
    expect(tree.byAddr.get('1210')!.children).toHaveLength(11);
    expect(tree.byAddr.get('1211')!.devices).toEqual([75]);
  });
});

describe('validate', () => {
  it('finds no errors in the sample', () => {
    const { doc, lineIndex } = parse(SAMPLE);
    expect(validate(doc, lineIndex).filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('flags duplicates, bad IPs and unnamed parents', () => {
    const { doc, lineIndex } = parse(
      '[Combiner Services]\nIpShare0=1.2.3.999,2050,1110,-,2050,-,2050,\n[NetNames]\n1000=A\n1000=B\n1110=C\n',
    );
    const msgs = validate(doc, lineIndex).map((d) => d.message);
    expect(msgs.some((m) => m.includes('named more than once'))).toBe(true);
    expect(msgs.some((m) => m.includes('not a valid IPv4'))).toBe(true);
    expect(msgs.some((m) => m.includes('1100 has children but no name'))).toBe(true);
  });
});

describe('ops', () => {
  const base = () => parse('[Combiner Services]\n[NetNames]\n0000=Root\n1000=Frames\n1100=Video\n1110=V1\n').doc;

  it('adds a child in the next free slot, next to its siblings', () => {
    const { doc, addr } = addChild(base(), '1000', 'Audio');
    expect(addr).toBe('1200');
    expect(doc.netNames.map((n) => n.addr)).toEqual(['0000', '1000', '1100', '1110', '1200']);
  });

  it('bulk-adds children with names and incrementing IPs', () => {
    const { doc, addrs } = bulkAddChildren(base(), '1100', {
      count: 3,
      namePattern: 'Video {n:2}',
      startNumber: 2,
      device: { ip1: '10.0.0.10', port1: '2050', ip2: '-', port2: '2050', ip3: '-', port3: '2050', step: 10 },
    });
    expect(addrs).toEqual(['1120', '1130', '1140']);
    expect(doc.netNames.slice(-3).map((n) => n.name)).toEqual(['Video 02', 'Video 03', 'Video 04']);
    expect(doc.ipShares.map((s) => s.ip1)).toEqual(['10.0.0.10', '10.0.0.20', '10.0.0.30']);
  });

  it('moves, shifts and removes subtrees', () => {
    let doc = moveSubtree(base(), '1100', '2000');
    expect(doc.netNames.map((n) => n.addr)).toEqual(['0000', '1000', '2000', '2100']);
    doc = shiftNet(base(), '1100', 1).doc;
    expect(doc.netNames.map((n) => n.addr)).toEqual(['0000', '1000', '1200', '1210']);
    doc = removeSubtree(base(), '1100');
    expect(doc.netNames.map((n) => n.addr)).toEqual(['0000', '1000']);
    expect(() => moveSubtree(base(), '1000', '1100')).toThrow();
  });

  it('renames and sorts', () => {
    let doc = setNetName(base(), '1110', 'Video 01');
    expect(doc.netNames[3].name).toBe('Video 01');
    doc = sortNetNames(parse('[NetNames]\n1100=b\n0000=r\n1000=a\n').doc);
    expect(doc.netNames.map((n) => n.addr)).toEqual(['0000', '1000', '1100']);
  });

  it('helpers', () => {
    expect(formatPattern('Cam {n:3} ({x})', 7, 11)).toBe('Cam 007 (B)');
    expect(incrementIp('10.0.0.250', 10)).toBe('10.0.1.4');
    expect(incrementIp('-', 10)).toBe('-');
  });
});
