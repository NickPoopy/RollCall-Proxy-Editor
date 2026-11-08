import { inSubtree, parentOf, ROOT } from './address';
import type { NetAddr, ProxyDoc } from './types';

/**
 * Layer 3 point-to-point addressing. Each device sits alone in its own
 * subnet, so "the next device" is the next subnet, not the next address:
 *   flat  every address               .10 .11 .12
 *   /31   2-address blocks, odd host   .1  .3  .5   (switch on the even)
 *   /30   4-address blocks, host .2    .2  .6  .10  (switch .1, .0/.3 unusable)
 * The proxy file only stores bare IPs; the scheme is an editor setting per branch.
 */
export type Scheme = 'flat' | '/31' | '/30';
export const SCHEMES: Scheme[] = ['flat', '/31', '/30'];
export const SCHEME_LABEL: Record<Scheme, string> = {
  flat: 'Flat (every address)',
  '/31': 'L3 /31 (device on odd)',
  '/30': 'L3 /30 (device on .2)',
};
const SIZE: Record<Scheme, number> = { flat: 1, '/31': 2, '/30': 4 };
/** Where the device sits inside its block. */
const HOST: Record<Scheme, number> = { flat: 0, '/31': 1, '/30': 2 };

export function isScheme(s: unknown): s is Scheme {
  return s === 'flat' || s === '/31' || s === '/30';
}

export function ipToInt(ip: string): number | null {
  const p = ip.trim().split('.');
  if (p.length !== 4) return null;
  const n = p.map(Number);
  if (n.some((x, i) => !/^\d{1,3}$/.test(p[i]) || x > 255)) return null;
  return ((n[0] << 24) >>> 0) + (n[1] << 16) + (n[2] << 8) + n[3];
}

export function intToIp(v: number): string {
  const x = ((v % 2 ** 32) + 2 ** 32) % 2 ** 32;
  return [x >>> 24, (x >>> 16) & 255, (x >>> 8) & 255, x & 255].join('.');
}

/**
 * Turn "10.20.0.8/30" into the device address for that subnet ("10.20.0.10").
 * Plain IPs pass through. Returns an error string for unsupported input.
 */
export function resolveCidr(input: string): string | { error: string } {
  const s = input.trim();
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(s);
  if (!m) return s;
  const base = ipToInt(m[1]);
  if (base === null) return { error: `"${m[1]}" is not an IP address` };
  const prefix = Number(m[2]);
  const scheme: Scheme | null = prefix === 30 ? '/30' : prefix === 31 ? '/31' : prefix === 32 ? 'flat' : null;
  if (!scheme) return { error: `Only /30, /31 and /32 can be turned into a device address (got /${prefix})` };
  const size = SIZE[scheme];
  return intToIp(base - (base % size) + HOST[scheme]);
}

/** The device address `index` devices after `start`, stepping by whole subnets. "-" stays "-". */
export function nthDevice(start: string, index: number, scheme: Scheme): string {
  const s = start.trim();
  if (s === '' || s === '-') return '-';
  const resolved = resolveCidr(s);
  if (typeof resolved !== 'string') throw new Error(resolved.error);
  const v = ipToInt(resolved);
  if (v === null) throw new Error(`"${s}" is not an IP address`);
  return intToIp(v + index * SIZE[scheme]);
}

/** Snap an address to the device position of its subnet (e.g. /30: .8 -> .10). */
export function snapToHost(ip: string, scheme: Scheme): string {
  const v = ipToInt(ip);
  if (v === null || scheme === 'flat') return ip;
  return intToIp(v - (v % SIZE[scheme]) + HOST[scheme]);
}

/** Network address and prefix of the subnet an IP belongs to, e.g. "10.20.0.8/30". */
export function subnetOf(ip: string, scheme: Scheme): string | null {
  const v = ipToInt(ip);
  if (v === null || scheme === 'flat') return null;
  return `${intToIp(v - (v % SIZE[scheme]))}${scheme}`;
}

/** Why this address is wrong for a device under the scheme, or null if it's fine. */
export function hostProblem(ip: string, scheme: Scheme): string | null {
  const v = ipToInt(ip);
  if (v === null || scheme === 'flat') return null;
  const pos = v % SIZE[scheme];
  const net = subnetOf(ip, scheme);
  if (scheme === '/30') {
    if (pos === 0) return `${ip} is the network address of ${net}; the device should be ${snapToHost(ip, scheme)}`;
    if (pos === 3) return `${ip} is the broadcast address of ${net}; the device should be ${snapToHost(ip, scheme)}`;
    if (pos === 1) return `${ip} is the switch side of ${net}; the device is usually ${snapToHost(ip, scheme)}`;
  }
  if (scheme === '/31' && pos === 0) return `${ip} is the switch side of ${net}; the device is usually ${snapToHost(ip, scheme)}`;
  return null;
}

// ---------------- Scheme per branch ----------------

/** Explicit schemes set on nets; descendants inherit the nearest one. */
export type SchemeMap = Record<NetAddr, Scheme>;

export function schemeFor(map: SchemeMap, addr: NetAddr): Scheme {
  for (let a: NetAddr | null = addr; a !== null; a = parentOf(a)) {
    if (map[a]) return map[a];
  }
  return map[ROOT] ?? 'flat';
}

/** Where the scheme for `addr` comes from (the net that sets it), or null for the default. */
export function schemeSource(map: SchemeMap, addr: NetAddr): NetAddr | null {
  for (let a: NetAddr | null = addr; a !== null; a = parentOf(a)) if (map[a]) return a;
  return null;
}

/** Re-key a scheme map after nets moved (drag and drop, Move to…). */
export function remapSchemes(map: SchemeMap, f: (a: NetAddr) => NetAddr): SchemeMap {
  const out: SchemeMap = {};
  for (const [a, s] of Object.entries(map)) out[f(a)] = s;
  return out;
}

/** Drop entries for nets that no longer exist in the doc. */
export function pruneSchemes(map: SchemeMap, doc: ProxyDoc): SchemeMap {
  const used = new Set([ROOT, ...doc.netNames.map((n) => n.addr), ...doc.ipShares.map((s) => s.net)]);
  const out: SchemeMap = {};
  for (const [a, s] of Object.entries(map)) if ([...used].some((u) => inSubtree(u, a))) out[a] = s;
  return out;
}

/**
 * Suggest addresses for a new device on `net`: one device after the highest
 * Address 1 already used in the parent's branch, with Address 2/3 following in parallel.
 */
export function suggestDevice(doc: ProxyDoc, net: NetAddr, scheme: Scheme): { ip1: string; ip2: string; ip3: string } | null {
  const parent = parentOf(net) ?? ROOT;
  let best: { v: number; share: ProxyDoc['ipShares'][number] } | null = null;
  for (const s of doc.ipShares) {
    if (!inSubtree(s.net, parent)) continue;
    const v = ipToInt(s.ip1);
    if (v !== null && (!best || v > best.v)) best = { v, share: s };
  }
  if (!best) return null;
  const next = ipToInt(nthDevice(snapToHost(best.share.ip1, scheme), 1, scheme))!;
  const delta = next - best.v;
  const shift = (ip: string) => {
    const v = ipToInt(ip);
    return v === null ? '-' : intToIp(v + delta);
  };
  return { ip1: intToIp(next), ip2: shift(best.share.ip2), ip3: shift(best.share.ip3) };
}
