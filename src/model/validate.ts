import { depthOf, MAX_CHILDREN, ROOT, skipsLevel } from './address';
import { buildTree } from './tree';
import type { Diagnostic, LineIndex, ProxyDoc } from './types';
import { hostProblem, schemeFor, subnetOf, type SchemeMap } from './ipscheme';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isValidIp(s: string): boolean {
  return IPV4_RE.test(s);
}

export function isValidPort(s: string): boolean {
  if (!/^\d{1,5}$/.test(s)) return false;
  const n = Number(s);
  return n >= 1 && n <= 65535;
}

/** Checks the model for things RollCall is likely to choke on or that are probably mistakes. */
export function validate(doc: ProxyDoc, lineIndex?: LineIndex, schemes: SchemeMap = {}): Diagnostic[] {
  const out: Diagnostic[] = [];
  const netLine = (addr: string, nth = 0) => lineIndex?.netNames.get(addr)?.[nth];
  const shareLine = (i: number) => lineIndex?.ipShares[i];

  // NetNames
  const seen = new Map<string, number>();
  for (const n of doc.netNames) {
    const count = (seen.get(n.addr) ?? 0) + 1;
    seen.set(n.addr, count);
    if (count === 2) {
      out.push({
        severity: 'error',
        addr: n.addr,
        line: netLine(n.addr, 1),
        message: `Address ${n.addr} is named more than once`,
      });
    }
    if (count === 1) {
      if (n.name.trim() === '') {
        out.push({ severity: 'warning', addr: n.addr, line: netLine(n.addr), message: `${n.addr} has an empty name` });
      }
      if (skipsLevel(n.addr)) {
        out.push({
          severity: 'warning',
          addr: n.addr,
          line: netLine(n.addr),
          message: `${n.addr} skips a level (a 0 digit before a non-zero one)`,
        });
      }
    }
  }

  // Tree shape
  const tree = buildTree(doc);
  for (const node of tree.byAddr.values()) {
    if (!node.named && node.addr !== ROOT) {
      const why = node.children.length > 0 ? 'has children' : 'has devices';
      out.push({ severity: 'warning', addr: node.addr, message: `${node.addr} ${why} but no name in [NetNames]` });
    }
    if (node.children.length > MAX_CHILDREN) {
      out.push({ severity: 'error', addr: node.addr, message: `${node.addr} has more than ${MAX_CHILDREN} children` });
    }
    if (node.devices.length > 0 && depthOf(node.addr) === 0) {
      out.push({ severity: 'error', addr: node.addr, message: 'Devices cannot be attached to the root net 0000' });
    }
  }
  if (!tree.byAddr.get(ROOT)!.named && doc.netNames.length > 0) {
    out.push({ severity: 'info', addr: ROOT, message: 'No root name (0000=...) in [NetNames]' });
  }

  // IpShares
  const endpoints = new Map<string, number>();
  doc.ipShares.forEach((s, i) => {
    const line = shareLine(i);
    const base = { ipShareIndex: i, addr: s.net, line };
    if (!isValidIp(s.ip1)) out.push({ ...base, severity: 'error', message: `IpShare${i}: Address 1 "${s.ip1}" is not a valid IPv4 address` });
    if (!isValidPort(s.port1)) out.push({ ...base, severity: 'error', message: `IpShare${i}: Port 1 "${s.port1}" is not a valid port` });
    for (const [ip, port, label] of [
      [s.ip2, s.port2, '2'],
      [s.ip3, s.port3, '3'],
    ] as const) {
      if (ip !== '-' && !isValidIp(ip)) {
        out.push({ ...base, severity: 'error', message: `IpShare${i}: Address ${label} "${ip}" must be an IPv4 address or "-"` });
      }
      if (!isValidPort(port)) {
        out.push({ ...base, severity: 'error', message: `IpShare${i}: Port ${label} "${port}" is not a valid port` });
      }
    }
    const key = `${s.ip1}:${s.port1}`;
    const prev = endpoints.get(key);
    if (prev !== undefined) {
      out.push({
        ...base,
        severity: 'warning',
        message: `IpShare${i}: ${key} is also used by IpShare${prev}`,
      });
    } else {
      endpoints.set(key, i);
    }
  });

  // Layer 3 point-to-point checks, for branches set to /30 or /31.
  const subnets = new Map<string, { i: number; ip: string }>();
  doc.ipShares.forEach((s, i) => {
    const scheme = schemeFor(schemes, s.net);
    if (scheme === 'flat') return;
    const base = { ipShareIndex: i, addr: s.net, line: shareLine(i) };
    [s.ip1, s.ip2, s.ip3].forEach((ip, slot) => {
      if (!isValidIp(ip)) return;
      const problem = hostProblem(ip, scheme);
      if (problem) out.push({ ...base, severity: 'warning', message: `IpShare${i}: Address ${slot + 1}: ${problem}` });
      const key = `${slot}|${subnetOf(ip, scheme)}`;
      const prev = subnets.get(key);
      if (prev && prev.ip !== ip) {
        out.push({ ...base, severity: 'warning', message: `IpShare${i}: ${ip} is in the same ${scheme} as IpShare${prev.i} (${prev.ip}): ${subnetOf(ip, scheme)}` });
      } else if (!prev) {
        subnets.set(key, { i, ip });
      }
    });
  });

  return out;
}
