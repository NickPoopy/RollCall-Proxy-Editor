import {
  childAddr,
  childDigit,
  compareAddr,
  depthOf,
  digitsOf,
  inSubtree,
  isValidAddr,
  MAX_DEPTH,
  normAddr,
  parentOf,
  ROOT,
} from './address';
import type { Entry, IpShare, NetAddr, ProxyDoc } from './types';

/**
 * Pure edit operations on a ProxyDoc. Each returns a new doc and never
 * mutates its input. Operations that can't be done throw an OpError with a
 * message suitable for showing to the user.
 */
export class OpError extends Error {}

function usedAddrs(doc: ProxyDoc): Set<NetAddr> {
  const s = new Set<NetAddr>();
  doc.netNames.forEach((n) => s.add(n.addr));
  doc.ipShares.forEach((x) => s.add(x.net));
  return s;
}

function occupied(doc: ProxyDoc, root: NetAddr): boolean {
  for (const a of usedAddrs(doc)) if (inSubtree(a, root)) return true;
  return false;
}

/** Insert index for a new NetNames entry: right after the last entry in the parent's subtree. */
function netInsertIndex(doc: ProxyDoc, addr: NetAddr): number {
  const parent = parentOf(addr) ?? ROOT;
  // Prefer to follow the closest preceding sibling's subtree, else the parent's subtree.
  let at = -1;
  doc.netNames.forEach((n, i) => {
    if (n.addr !== ROOT && inSubtree(n.addr, parent) && compareAddr(n.addr, addr) < 0) at = i;
  });
  if (at < 0) doc.netNames.forEach((n, i) => (parent !== ROOT && inSubtree(n.addr, parent) ? (at = i) : undefined));
  return at < 0 ? doc.netNames.length : at + 1;
}

function shareInsertIndex(doc: ProxyDoc, net: NetAddr): number {
  const parent = parentOf(net) ?? ROOT;
  let at = -1;
  doc.ipShares.forEach((s, i) => {
    if (inSubtree(s.net, parent) && parent !== ROOT) at = i;
  });
  return at < 0 ? doc.ipShares.length : at + 1;
}

// ---------- NetNames ----------

export function setNetName(doc: ProxyDoc, addr: NetAddr, name: string): ProxyDoc {
  const i = doc.netNames.findIndex((n) => n.addr === addr);
  if (i < 0) return insertNetName(doc, addr, name);
  const netNames = [...doc.netNames];
  netNames[i] = { addr, name };
  return { ...doc, netNames };
}

export function insertNetName(doc: ProxyDoc, addr: NetAddr, name: string): ProxyDoc {
  const netNames = [...doc.netNames];
  netNames.splice(netInsertIndex(doc, addr), 0, { addr, name });
  return { ...doc, netNames };
}

export function addChild(doc: ProxyDoc, parent: NetAddr, name: string): { doc: ProxyDoc; addr: NetAddr } {
  if (depthOf(parent) >= MAX_DEPTH) throw new OpError(`${parent} is already at the deepest level (4)`);
  const used = usedAddrs(doc);
  for (let d = 1; d <= 15; d++) {
    const a = childAddr(parent, d)!;
    if (![...used].some((u) => inSubtree(u, a))) return { doc: insertNetName(doc, a, name), addr: a };
  }
  throw new OpError(`${parent} already has 15 children (the maximum)`);
}

/** Expand a name pattern: {n} = number, {n:2} = zero-padded to 2, {x} = hex digit. */
export function formatPattern(pattern: string, n: number, digit: number): string {
  return pattern
    .replace(/\{n(?::(\d+))?\}/g, (_m, pad) => (pad ? String(n).padStart(Number(pad), '0') : String(n)))
    .replace(/\{x\}/g, digit.toString(16).toUpperCase());
}

/** Add `step` to the last octet of an IPv4 address, carrying into earlier octets. "-" stays "-". */
export function incrementIp(ip: string, step: number): string {
  if (ip === '-' || step === 0) return ip;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return ip;
  let v = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3] + step;
  v = ((v % 2 ** 32) + 2 ** 32) % 2 ** 32;
  return [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].join('.');
}

export interface DeviceTemplate {
  ip1: string;
  port1: string;
  ip2: string;
  port2: string;
  ip3: string;
  port3: string;
  /** How much to add to each address's last octet for every new child. */
  step: number;
}

export interface BulkAddOptions {
  count: number;
  namePattern: string;
  startNumber: number;
  device?: DeviceTemplate;
}

export function bulkAddChildren(doc: ProxyDoc, parent: NetAddr, opts: BulkAddOptions): { doc: ProxyDoc; addrs: NetAddr[] } {
  if (opts.count < 1) throw new OpError('Count must be at least 1');
  let cur = doc;
  const addrs: NetAddr[] = [];
  for (let k = 0; k < opts.count; k++) {
    const used = usedAddrs(cur);
    let a: NetAddr | null = null;
    for (let d = 1; d <= 15 && !a; d++) {
      const c = childAddr(parent, d);
      if (c && ![...used].some((u) => inSubtree(u, c))) a = c;
    }
    if (!a) {
      throw new OpError(
        depthOf(parent) >= MAX_DEPTH
          ? `${parent} is already at the deepest level (4)`
          : `Only ${k} free slot(s) under ${parent}; a net can have at most 15 children`,
      );
    }
    cur = insertNetName(cur, a, formatPattern(opts.namePattern, opts.startNumber + k, childDigit(a)));
    if (opts.device) {
      const t = opts.device;
      const s = k * t.step;
      cur = addIpShare(cur, a, {
        ip1: incrementIp(t.ip1, s),
        port1: t.port1,
        ip2: incrementIp(t.ip2, s),
        port2: t.port2,
        ip3: incrementIp(t.ip3, s),
        port3: t.port3,
      });
    }
    addrs.push(a);
  }
  return { doc: cur, addrs };
}

export function removeSubtree(doc: ProxyDoc, addr: NetAddr): ProxyDoc {
  if (addr === ROOT) throw new OpError('The root cannot be deleted');
  return {
    ...doc,
    netNames: doc.netNames.filter((n) => !inSubtree(n.addr, addr)),
    ipShares: doc.ipShares.filter((s) => !inSubtree(s.net, addr)),
  };
}

/** Map an address from one subtree root to another, which may be at a different depth. */
function rebaseAddr(a: NetAddr, from: NetAddr, to: NetAddr): NetAddr {
  const df = depthOf(from);
  const dt = depthOf(to);
  const rest = digitsOf(a).slice(df);
  const head = digitsOf(to).slice(0, dt);
  const all = [...head, ...rest];
  if (all.slice(MAX_DEPTH).some((d) => d !== 0)) throw new OpError('Not enough levels left to move it there');
  return all
    .slice(0, MAX_DEPTH)
    .concat(Array(Math.max(0, MAX_DEPTH - all.length)).fill(0))
    .map((d) => d.toString(16).toUpperCase())
    .join('');
}

/** Move a whole subtree (names and devices) to a new address. */
export function moveSubtree(doc: ProxyDoc, from: NetAddr, toRaw: string): ProxyDoc {
  const to = normAddr(toRaw);
  if (!isValidAddr(to)) throw new OpError(`"${toRaw}" is not a 4-digit hex address`);
  if (from === ROOT || to === ROOT) throw new OpError('The root cannot be moved');
  if (to === from) return doc;
  if (inSubtree(to, from)) throw new OpError('Cannot move a net inside itself');
  if (occupied(doc, to)) throw new OpError(`${to} is already in use`);
  const map = (a: NetAddr) => (inSubtree(a, from) ? rebaseAddr(a, from, to) : a);
  return {
    ...doc,
    netNames: doc.netNames.map((n) => ({ ...n, addr: map(n.addr) })),
    ipShares: doc.ipShares.map((s) => ({ ...s, net: map(s.net) })),
  };
}

/** Swap two sibling subtrees (used for move up / down). */
export function swapSubtrees(doc: ProxyDoc, a: NetAddr, b: NetAddr): ProxyDoc {
  if (depthOf(a) !== depthOf(b)) throw new OpError('Only nets at the same level can be swapped');
  const map = (x: NetAddr) => (inSubtree(x, a) ? rebaseAddr(x, a, b) : inSubtree(x, b) ? rebaseAddr(x, b, a) : x);
  return {
    ...doc,
    netNames: doc.netNames.map((n) => ({ ...n, addr: map(n.addr) })),
    ipShares: doc.ipShares.map((s) => ({ ...s, net: map(s.net) })),
  };
}

/** Move a net one slot up (-1) or down (+1) among its siblings, swapping if the slot is taken. */
export function shiftNet(doc: ProxyDoc, addr: NetAddr, dir: -1 | 1): { doc: ProxyDoc; addr: NetAddr } {
  const parent = parentOf(addr);
  if (parent === null) throw new OpError('The root cannot be moved');
  const target = childAddr(parent, childDigit(addr) + dir);
  if (!target) throw new OpError(dir < 0 ? 'Already the first slot' : 'Already the last slot (F)');
  return { doc: occupied(doc, target) ? swapSubtrees(doc, addr, target) : moveSubtree(doc, addr, target), addr: target };
}

export function sortNetNames(doc: ProxyDoc): ProxyDoc {
  return { ...doc, netNames: [...doc.netNames].sort((a, b) => compareAddr(a.addr, b.addr)) };
}

// ---------- IpShares ----------

export type DeviceFields = Pick<IpShare, 'ip1' | 'port1' | 'ip2' | 'port2' | 'ip3' | 'port3'>;

export const EMPTY_DEVICE: DeviceFields = { ip1: '0.0.0.0', port1: '2050', ip2: '-', port2: '2050', ip3: '-', port3: '2050' };

export function addIpShare(doc: ProxyDoc, net: NetAddr, fields: Partial<DeviceFields> = {}): ProxyDoc {
  const share: IpShare = { ...EMPTY_DEVICE, ...fields, net, extra: [], trailingComma: true };
  const ipShares = [...doc.ipShares];
  ipShares.splice(shareInsertIndex(doc, net), 0, share);
  return { ...doc, ipShares };
}

export function updateIpShare(doc: ProxyDoc, index: number, patch: Partial<IpShare>): ProxyDoc {
  const ipShares = [...doc.ipShares];
  const next = { ...ipShares[index], ...patch };
  if (patch.net !== undefined) next.net = normAddr(patch.net);
  ipShares[index] = next;
  return { ...doc, ipShares };
}

export function removeIpShare(doc: ProxyDoc, index: number): ProxyDoc {
  return { ...doc, ipShares: doc.ipShares.filter((_, i) => i !== index) };
}

// ---------- Plain key/value settings ----------

function mapSection(doc: ProxyDoc, sIdx: number, fn: (entries: Entry[]) => Entry[]): ProxyDoc {
  const sections = doc.sections.map((s, i) => (i === sIdx ? { ...s, entries: fn([...s.entries]) } : s));
  return { ...doc, sections };
}

export function setEntry(doc: ProxyDoc, sIdx: number, eIdx: number, key: string, value: string): ProxyDoc {
  return mapSection(doc, sIdx, (es) => {
    es[eIdx] = { type: 'kv', key, value };
    return es;
  });
}

export function addEntry(doc: ProxyDoc, sIdx: number, key: string, value: string): ProxyDoc {
  return mapSection(doc, sIdx, (es) => {
    let at = -1;
    es.forEach((e, i) => (e.type !== 'raw' ? (at = i) : undefined));
    es.splice(at + 1, 0, { type: 'kv', key, value });
    return es;
  });
}

export function removeEntry(doc: ProxyDoc, sIdx: number, eIdx: number): ProxyDoc {
  return mapSection(doc, sIdx, (es) => es.filter((_, i) => i !== eIdx));
}
