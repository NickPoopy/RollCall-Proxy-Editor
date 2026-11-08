import { describe, expect, it } from 'vitest';
import { applyOutline, cloneSubtree, parseOutline } from './bulk';
import { hostProblem, nthDevice, pruneSchemes, remapSchemes, resolveCidr, schemeFor, snapToHost, subnetOf, suggestDevice } from './ipscheme';
import { bulkAddChildren, moveNet, removeSubtree } from './ops';
import { parse } from './parse';
import { BUILTIN_PREFABS, defaultValues, prefabFromBranch, renderPrefab } from './prefabs';
import { validate } from './validate';

/** The address cells of every device line in a rendered outline. */
const ips = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim().split('\t').slice(1).join(' '))
    .filter(Boolean);

describe('L3 address maths', () => {
  it('steps by whole subnets and carries across octets', () => {
    expect([0, 1, 2].map((i) => nthDevice('10.20.0.2', i, '/30'))).toEqual(['10.20.0.2', '10.20.0.6', '10.20.0.10']);
    expect([0, 1, 2].map((i) => nthDevice('10.20.0.1', i, '/31'))).toEqual(['10.20.0.1', '10.20.0.3', '10.20.0.5']);
    expect(nthDevice('10.20.0.254', 1, '/30')).toBe('10.20.1.2');
    expect(nthDevice('10.20.0.255', 1, '/31')).toBe('10.20.1.1');
    expect(nthDevice('10.20.0.10', 3, 'flat')).toBe('10.20.0.13');
    expect(nthDevice('-', 3, '/30')).toBe('-');
  });

  it('turns a subnet into the device address', () => {
    expect(resolveCidr('10.20.0.8/30')).toBe('10.20.0.10');
    expect(resolveCidr('10.20.0.9/30')).toBe('10.20.0.10'); // any address in the /30
    expect(resolveCidr('10.20.0.8/31')).toBe('10.20.0.9');
    expect(resolveCidr('10.20.0.8/32')).toBe('10.20.0.8');
    expect(resolveCidr('10.20.0.0/24')).toEqual({ error: expect.stringContaining('/24') });
    expect(nthDevice('10.20.0.8/30', 1, '/30')).toBe('10.20.0.14');
    expect(snapToHost('10.20.0.12', '/30')).toBe('10.20.0.14');
    expect(subnetOf('10.20.0.14', '/30')).toBe('10.20.0.12/30');
  });

  it('spots network, broadcast and switch-side addresses', () => {
    expect(hostProblem('10.20.0.8', '/30')).toMatch(/network address of 10.20.0.8\/30.*10.20.0.10/);
    expect(hostProblem('10.20.0.11', '/30')).toMatch(/broadcast/);
    expect(hostProblem('10.20.0.9', '/30')).toMatch(/switch side/);
    expect(hostProblem('10.20.0.10', '/30')).toBeNull();
    expect(hostProblem('10.20.0.8', '/31')).toMatch(/switch side/);
    expect(hostProblem('10.20.0.9', '/31')).toBeNull();
    expect(hostProblem('10.20.0.8', 'flat')).toBeNull();
  });

  it('inherits schemes down the tree and follows moves', () => {
    const map = { '2000': '/30' as const, '2200': 'flat' as const };
    expect(schemeFor(map, '2115')).toBe('/30');
    expect(schemeFor(map, '2210')).toBe('flat');
    expect(schemeFor(map, '1111')).toBe('flat');
    const doc = parse('[NetNames]\n2000=A\n2100=B\n2200=C\n3000=D\n').doc;
    const m = moveNet(doc, '2000', '3000');
    expect(remapSchemes(map, m.remap)).toEqual({ '3100': '/30', '3120': 'flat' });
    expect(pruneSchemes(map, removeSubtree(doc, '2200'))).toEqual({ '2000': '/30' });
  });
});

describe('L3 in the tools', () => {
  const base = () => parse('[Combiner Services]\n[NetNames]\n0000=R\n2000=MVs\n').doc;

  it('bulk add steps by subnet, Address 2 in parallel', () => {
    const r = bulkAddChildren(base(), '2000', {
      count: 3,
      namePattern: 'MV {n}',
      startNumber: 1,
      device: { ip1: '10.20.0.2', port1: '2050', ip2: '10.21.0.2', port2: '2050', ip3: '-', port3: '2050', step: 1, scheme: '/30' },
    });
    expect(r.doc.ipShares.map((s) => [s.ip1, s.ip2])).toEqual([
      ['10.20.0.2', '10.21.0.2'],
      ['10.20.0.6', '10.21.0.6'],
      ['10.20.0.10', '10.21.0.10'],
    ]);
  });

  it('Multiviewers prefab on /31, back to back across a /24', () => {
    const p = BUILTIN_PREFABS.find((x) => x.id === 'builtin-multiviewer')!;
    const out = renderPrefab(p, { ...defaultValues(p), scheme: '/31', count: 2, ports: 2, step: 3, ip: '10.20.0.251' });
    expect(ips(out)).toEqual(['10.20.0.251', '10.20.0.253', '10.20.0.255', '10.20.1.1', '10.20.1.3', '10.20.1.5']);
  });

  it('prefab IP settings accept a subnet', () => {
    const p = BUILTIN_PREFABS.find((x) => x.id === 'builtin-multiviewer')!;
    const out = renderPrefab(p, { ...defaultValues(p), scheme: '/30', count: 1, ports: 1, ip: '10.20.0.16/30' });
    expect(ips(out)).toEqual(['10.20.0.18', '10.20.0.22']);
  });

  it('duplicate shifts by whole blocks and carries', () => {
    let doc = base();
    doc = bulkAddChildren(doc, '2000', { count: 1, namePattern: 'MV1', startNumber: 1 }).doc;
    doc = bulkAddChildren(doc, '2100', {
      count: 2,
      namePattern: 'Port {n}',
      startNumber: 1,
      device: { ip1: '10.20.0.250', port1: '2050', ip2: '-', port2: '2050', ip3: '-', port3: '2050', step: 1, scheme: '/30' },
    }).doc;
    const r = cloneSubtree(doc, '2100', { copies: 2, startNumber: 2, renameRules: [{ find: 'MV1', replace: 'MV{n}' }], ip: { scheme: '/30', step: 2 } });
    expect(r.doc.ipShares.map((s) => s.ip1)).toEqual(['10.20.0.250', '10.20.0.254', '10.20.1.2', '10.20.1.6', '10.20.1.10', '10.20.1.14']);
  });

  it('outline cells accept subnets', () => {
    const { rows, errors } = parseOutline('Cam 1\t10.20.0.8/30\t10.21.0.8/30\nCam 2 @ 10.20.0.12/31:2051');
    expect(errors).toEqual([]);
    const r = applyOutline(base(), '2000', rows, { defaultPort: '2050', merge: true });
    expect(r.doc.ipShares.map((s) => [s.ip1, s.ip2, s.port1])).toEqual([
      ['10.20.0.10', '10.21.0.10', '2050'],
      ['10.20.0.13', '-', '2051'],
    ]);
  });

  it('suggests the next device address in the branch', () => {
    let doc = bulkAddChildren(base(), '2000', {
      count: 2,
      namePattern: 'Cam {n}',
      startNumber: 1,
      device: { ip1: '10.20.0.2', port1: '2050', ip2: '10.21.0.2', port2: '2050', ip3: '-', port3: '2050', step: 1, scheme: '/30' },
    }).doc;
    doc = bulkAddChildren(doc, '2000', { count: 1, namePattern: 'Cam 3', startNumber: 1 }).doc;
    expect(suggestDevice(doc, '2300', '/30')).toEqual({ ip1: '10.20.0.10', ip2: '10.21.0.10', ip3: '-' });
    expect(suggestDevice(doc, '2300', 'flat')).toEqual({ ip1: '10.20.0.7', ip2: '10.21.0.7', ip3: '-' });
  });

  it('prefab from an L3 branch steps by the whole block', () => {
    let doc = bulkAddChildren(base(), '2000', { count: 1, namePattern: 'MV1', startNumber: 1 }).doc;
    doc = bulkAddChildren(doc, '2100', {
      count: 5,
      namePattern: 'P{n}',
      startNumber: 1,
      device: { ip1: '10.20.0.2', port1: '2050', ip2: '-', port2: '2050', ip3: '-', port3: '2050', step: 1, scheme: '/30' },
    }).doc;
    const p = prefabFromBranch(doc, '2100', '2050', '/30');
    expect(p.params.find((x) => x.key === 'step')!.default).toBe(20);
  });
});

describe('L3 validation', () => {
  it('flags bad host positions and shared subnets only where the scheme is L3', () => {
    const { doc, lineIndex } = parse(
      [
        '[Combiner Services]',
        'IpShare0=10.20.0.8,2050,2110,-,2050,-,2050,',
        'IpShare1=10.20.0.10,2050,2120,-,2050,-,2050,',
        'IpShare2=10.20.0.9,2050,2130,-,2050,-,2050,',
        'IpShare3=10.20.0.8,2050,3110,-,2050,-,2050,',
        '[NetNames]',
        '2000=L3',
        '2100=MVs',
        '2110=A',
        '2120=B',
        '2130=C',
        '3000=Flat',
        '3100=X',
        '3110=Y',
        '',
      ].join('\n'),
    );
    const msgs = validate(doc, lineIndex, { '2000': '/30' }).map((d) => d.message);
    expect(msgs.filter((m) => m.includes('network address'))).toHaveLength(1);
    expect(msgs.filter((m) => m.includes('switch side'))).toHaveLength(1);
    expect(msgs.filter((m) => m.includes('same /30'))).toHaveLength(2);
    // The flat branch's 10.20.0.8 is not judged as /30.
    expect(msgs.some((m) => m.startsWith('IpShare3') && !m.includes('also used'))).toBe(false);
    expect(validate(doc, lineIndex).some((m) => m.message.includes('/30'))).toBe(false);
  });
});
