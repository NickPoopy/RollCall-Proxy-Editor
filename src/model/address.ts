import type { NetAddr } from './types';

/**
 * RollCall proxy net addresses are 4 hex digits. Each digit is one level of
 * the tree and 0 means "level not used":
 *   1000 -> top-level item 1
 *   1200 -> child 2 of 1000
 *   1210 -> child 1 of 1200
 * RollCall shows each net as `parentNet:DD:00`, where DD is the net's own
 * digit, e.g. 1210 -> "1200:01:00" and 1000 -> "0000:01:00".
 */

export const ROOT: NetAddr = '0000';
export const MAX_DEPTH = 4;
export const MAX_CHILDREN = 15;

const ADDR_RE = /^[0-9A-Fa-f]{4}$/;

export function isValidAddr(s: string): boolean {
  return ADDR_RE.test(s);
}

export function normAddr(s: string): NetAddr {
  return s.trim().toUpperCase();
}

export function digitsOf(addr: NetAddr): number[] {
  return addr.split('').map((c) => parseInt(c, 16));
}

export function fromDigits(d: number[]): NetAddr {
  return d.map((n) => n.toString(16).toUpperCase()).join('');
}

/** Number of used levels: 0000 -> 0, 1000 -> 1, 1210 -> 3, 1211 -> 4. */
export function depthOf(addr: NetAddr): number {
  const d = digitsOf(addr);
  for (let i = d.length - 1; i >= 0; i--) if (d[i] !== 0) return i + 1;
  return 0;
}

/** True when a zero digit comes before a non-zero one (e.g. 1010). */
export function skipsLevel(addr: NetAddr): boolean {
  const d = digitsOf(addr);
  const depth = depthOf(addr);
  for (let i = 0; i < depth; i++) if (d[i] === 0) return true;
  return false;
}

export function parentOf(addr: NetAddr): NetAddr | null {
  const depth = depthOf(addr);
  if (depth === 0) return null;
  const d = digitsOf(addr);
  d[depth - 1] = 0;
  return fromDigits(d);
}

/** The node's own digit at its level (1..15). 0 for the root. */
export function childDigit(addr: NetAddr): number {
  const depth = depthOf(addr);
  return depth === 0 ? 0 : digitsOf(addr)[depth - 1];
}

export function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

/** The address RollCall shows for this net, e.g. 1210 -> "1200:01:00". */
export function displayAddr(addr: NetAddr): string {
  const parent = parentOf(addr) ?? ROOT;
  return `${parent}:${hex2(childDigit(addr))}:00`;
}

/** Address of the given child digit (1..15) under parent. Null if parent is at max depth. */
export function childAddr(parent: NetAddr, digit: number): NetAddr | null {
  const depth = depthOf(parent);
  if (depth >= MAX_DEPTH || digit < 1 || digit > MAX_CHILDREN) return null;
  const d = digitsOf(parent);
  d[depth] = digit;
  return fromDigits(d);
}

/** First unused child digit under parent, given the set of addresses in use. */
export function nextFreeChild(parent: NetAddr, used: Set<NetAddr>): NetAddr | null {
  for (let digit = 1; digit <= MAX_CHILDREN; digit++) {
    const a = childAddr(parent, digit);
    if (!a) return null;
    if (![...used].some((u) => u === a || isDescendant(u, a))) return a;
  }
  return null;
}

/** True when `addr` sits strictly below `ancestor` in the tree. */
export function isDescendant(addr: NetAddr, ancestor: NetAddr): boolean {
  if (addr === ancestor) return false;
  const depth = depthOf(ancestor);
  if (depthOf(addr) <= depth) return false;
  return addr.slice(0, depth) === ancestor.slice(0, depth);
}

export function inSubtree(addr: NetAddr, root: NetAddr): boolean {
  return addr === root || isDescendant(addr, root);
}

/** Move `addr` from the `from` subtree to the `to` subtree (same depth required). */
export function rebase(addr: NetAddr, from: NetAddr, to: NetAddr): NetAddr {
  const depth = depthOf(from);
  return to.slice(0, depth) + addr.slice(depth);
}

/** Compare addresses so siblings sort by digit and parents come before children. */
export function compareAddr(a: NetAddr, b: NetAddr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
