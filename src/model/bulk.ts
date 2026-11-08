import { childAddr, childDigit, depthOf, inSubtree, MAX_CHILDREN, MAX_DEPTH, parentOf, ROOT } from './address';
import { addChild, addIpShare, formatPattern, insertNetName, OpError, rebaseAddr, usedAddrs } from './ops';
import { buildTree, type TreeNode } from './tree';
import type { IpShare, NetAddr, NetName, ProxyDoc } from './types';
import { isValidIp, isValidPort } from './validate';
import { intToIp, ipToInt, resolveCidr, type Scheme } from './ipscheme';

// =====================================================================
// Duplicate a subtree N times
// =====================================================================

export interface RenameRule {
  find: string;
  /** May contain {n} / {n:2}, replaced with the copy's number. */
  replace: string;
}

export interface CloneOptions {
  copies: number;
  /** Number used for {n} in the first copy. */
  startNumber: number;
  renameRules: RenameRule[];
  /**
   * How device IPs move per copy (times the copy index 1, 2, 3…):
   * - octet: add `step` to octet 3 or 4 (no carry)
   * - devices: move `step` whole subnets of the scheme (carries across octets); for flat that's `step` addresses
   */
  ip: { octet: 3 | 4; step: number; scheme?: undefined } | { scheme: Scheme; step: number; octet?: undefined };
}

const SCHEME_SIZE: Record<Scheme, number> = { flat: 1, '/31': 2, '/30': 4 };

function shiftBySubnets(ip: string, subnets: number, scheme: Scheme): string {
  if (ip === '-' || subnets === 0) return ip;
  const v = ipToInt(ip);
  if (v === null) return ip;
  const next = v + subnets * SCHEME_SIZE[scheme];
  if (next < 0 || next > 0xffffffff) throw new OpError(`Shifting ${ip} runs past the end of the IP range`);
  return intToIp(next);
}

export interface CloneResult {
  doc: ProxyDoc;
  copies: { root: NetAddr; name: string; nets: number; devices: number; firstIp: string | null }[];
}

/**
 * Suggest a rename rule from a name ending in a number:
 * "MV1" -> MV{n} (next 2), "Frame 01" -> Frame {n:2} (next 2).
 */
export function suggestRename(name: string): { rule: RenameRule; next: number } | null {
  const m = /^(.*?)(\d+)(\D*)$/.exec(name);
  if (!m) return null;
  const [, pre, num, post] = m;
  const token = num.length > 1 && num.startsWith('0') ? `{n:${num.length}}` : '{n}';
  return { rule: { find: name, replace: `${pre}${token}${post}` }, next: Number(num) + 1 };
}

export function applyRenameRules(name: string, rules: RenameRule[], n: number): string {
  let out = name;
  for (const r of rules) {
    if (!r.find) continue;
    out = out.split(r.find).join(formatPattern(r.replace, n, 0));
  }
  return out;
}

/** Add delta to one octet (1-4) of an IPv4 address. "-" passes through. Throws if it leaves 0-255. */
export function shiftOctet(ip: string, octet: 1 | 2 | 3 | 4, delta: number): string {
  if (ip === '-' || delta === 0) return ip;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p))) return ip;
  const v = parts[octet - 1] + delta;
  if (v < 0 || v > 255) throw new OpError(`Shifting ${ip} by ${delta} on octet ${octet} goes outside 0–255`);
  parts[octet - 1] = v;
  return parts.join('.');
}

/** Free sibling slots for copies of `src`: slots after it first, then the ones before. */
function freeSiblingSlots(doc: ProxyDoc, src: NetAddr): NetAddr[] {
  const parent = parentOf(src)!;
  const used = [...usedAddrs(doc)];
  const own = childDigit(src);
  const digits = [...Array(MAX_CHILDREN)].map((_, i) => i + 1);
  const order = [...digits.filter((d) => d > own), ...digits.filter((d) => d < own)];
  return order.map((d) => childAddr(parent, d)!).filter((a) => !used.some((u) => inSubtree(u, a)));
}

export function cloneSubtree(doc: ProxyDoc, src: NetAddr, opts: CloneOptions): CloneResult {
  if (src === ROOT) throw new OpError('The root cannot be duplicated');
  if (!(opts.copies >= 1)) throw new OpError('Copies must be at least 1');
  const srcNames = doc.netNames.filter((n) => inSubtree(n.addr, src));
  const srcShares = doc.ipShares.filter((s) => inSubtree(s.net, src));
  if (srcNames.length === 0 && srcShares.length === 0) throw new OpError(`Nothing to duplicate at ${src}`);

  const slots = freeSiblingSlots(doc, src);
  if (slots.length < opts.copies) {
    throw new OpError(`Only ${slots.length} free slot(s) next to ${src}. A net can have at most ${MAX_CHILDREN} children.`);
  }
  // Keep copies in address order for a tidy tree.
  const targets = slots.slice(0, opts.copies).sort();

  const newNames: NetName[] = [];
  const newShares: IpShare[] = [];
  const copies: CloneResult['copies'] = [];
  targets.forEach((root, k) => {
    const n = opts.startNumber + k;
    const delta = (k + 1) * opts.ip.step;
    const ipOpts = opts.ip;
    const shift = (ip: string) => (ipOpts.scheme ? shiftBySubnets(ip, delta, ipOpts.scheme) : shiftOctet(ip, ipOpts.octet, delta));
    const names = srcNames.map((x) => ({ addr: rebaseAddr(x.addr, src, root), name: applyRenameRules(x.name, opts.renameRules, n) }));
    const shares = srcShares.map((s) => ({
      ...s,
      extra: [...s.extra],
      net: rebaseAddr(s.net, src, root),
      ip1: shift(s.ip1),
      ip2: shift(s.ip2),
      ip3: shift(s.ip3),
    }));
    newNames.push(...names);
    newShares.push(...shares);
    copies.push({
      root,
      name: names.find((x) => x.addr === root)?.name ?? '',
      nets: names.length,
      devices: shares.length,
      firstIp: shares[0]?.ip1 ?? null,
    });
  });

  const lastIndex = <T>(arr: T[], pred: (x: T) => boolean) => arr.reduce((at, x, i) => (pred(x) ? i : at), -1);
  const netNames = [...doc.netNames];
  const ni = lastIndex(netNames, (x) => inSubtree(x.addr, src));
  netNames.splice(ni < 0 ? netNames.length : ni + 1, 0, ...newNames);
  const ipShares = [...doc.ipShares];
  const si = lastIndex(ipShares, (x) => inSubtree(x.net, src));
  ipShares.splice(si < 0 ? ipShares.length : si + 1, 0, ...newShares);

  return { doc: { ...doc, netNames, ipShares }, copies };
}

// =====================================================================
// Outline quick-entry
// =====================================================================

export interface OutlineAddr {
  ip: string;
  port?: string;
}

export interface OutlineRow {
  depth: number;
  name: string;
  /** Address 1..3; null = unused. */
  addrs: (OutlineAddr | null)[];
  /** 0-based line in the outline text. */
  line: number;
  /** Explicit slot digit (1-15) from a "[x] " prefix; otherwise the next free slot is used. */
  slot?: number;
}

export interface OutlineError {
  line: number;
  message: string;
}

const IP_PORT_RE = /^(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)(?::(\d{1,5}))?$/;

function parseAddrCell(cell: string): OutlineAddr | null | string {
  const c = cell.trim();
  if (c === '' || c === '-') return null;
  const m = IP_PORT_RE.exec(c);
  if (!m) return `"${c}" is not a valid IP address`;
  // "10.20.0.8/30" means "the device address in that subnet".
  const ip = resolveCidr(m[1]);
  if (typeof ip !== 'string') return ip.error;
  if (!isValidIp(ip)) return `"${c}" is not a valid IP address`;
  if (m[2] !== undefined && !isValidPort(m[2])) return `"${m[2]}" is not a valid port`;
  return { ip, port: m[2] };
}

/** Split a line body into its name and up to three address cells. */
function splitBody(body: string): { name: string; cells: string[] } {
  const at = body.indexOf('@');
  if (at >= 0) {
    return { name: body.slice(0, at).trim(), cells: body.slice(at + 1).split(/[,\t]/) };
  }
  if (body.includes('\t')) {
    const [name, ...cells] = body.split('\t');
    return { name: name.trim(), cells };
  }
  // Spaces only: peel trailing IP-looking tokens off the end.
  const tokens = body.trim().split(/\s+/);
  const cells: string[] = [];
  while (tokens.length > 1 && cells.length < 3 && /^(\d{1,3}(\.\d{1,3}){3}(:\d+)?|-)$/.test(tokens[tokens.length - 1])) {
    cells.unshift(tokens.pop()!);
  }
  return { name: tokens.join(' '), cells };
}

/**
 * Parse an indented outline. Indentation (tabs, or spaces) sets the depth.
 * Pasting from Excel works too: empty leading cells become tabs.
 */
export function parseOutline(text: string): { rows: OutlineRow[]; errors: OutlineError[] } {
  const lines = text.split(/\r?\n/);
  const errors: OutlineError[] = [];
  const raw: { tabs: number; spaces: number; body: string; line: number }[] = [];

  lines.forEach((l, i) => {
    if (l.trim() === '' || l.trim().startsWith('#')) return;
    const lead = /^[\t ]*/.exec(l)![0];
    raw.push({
      tabs: (lead.match(/\t/g) ?? []).length,
      spaces: (lead.match(/ /g) ?? []).length,
      body: l.slice(lead.length).replace(/[\t ]+$/, ''),
      line: i,
    });
  });

  const spaceCounts = raw.map((r) => r.spaces).filter((s) => s > 0);
  const unit = spaceCounts.length ? Math.min(...spaceCounts) : 1;
  const depths = raw.map((r) => r.tabs + Math.floor(r.spaces / unit));
  const base = depths.length ? Math.min(...depths) : 0;

  const rows: OutlineRow[] = [];
  let prevDepth = -1;
  raw.forEach((r, k) => {
    const depth = depths[k] - base;
    if (depth > prevDepth + 1) {
      errors.push({ line: r.line, message: `Indented ${depth - prevDepth} levels deeper than the line above; only one level at a time` });
      return;
    }
    let body = r.body;
    let slot: number | undefined;
    const sm = /^\[([0-9A-Fa-f])\]\s*/.exec(body);
    if (sm) {
      slot = parseInt(sm[1], 16);
      body = body.slice(sm[0].length);
      if (slot === 0) {
        errors.push({ line: r.line, message: 'Slot [0] is not allowed; use 1–F' });
        return;
      }
    }
    const { name, cells } = splitBody(body);
    if (!name) {
      errors.push({ line: r.line, message: 'Missing a name' });
      return;
    }
    while (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
    if (cells.length > 3) {
      errors.push({ line: r.line, message: `Only 3 addresses per device (found ${cells.length})` });
      return;
    }
    const addrs: (OutlineAddr | null)[] = [];
    for (const c of cells) {
      const a = parseAddrCell(c);
      if (typeof a === 'string') {
        errors.push({ line: r.line, message: a });
        return;
      }
      addrs.push(a);
    }
    if (!addrs[0] && addrs.some(Boolean)) {
      errors.push({ line: r.line, message: 'Address 1 is required when Address 2 or 3 is given' });
      return;
    }
    rows.push({ depth, name, addrs, line: r.line, slot });
    prevDepth = depth;
  });

  return { rows, errors };
}

export interface PlanRow {
  addr: NetAddr;
  name: string;
  depth: number;
  status: 'new' | 'existing';
  device: { ip: string; status: 'new' | 'existing' } | null;
}

export interface ApplyOutlineOptions {
  defaultPort: string;
  /** Reuse an existing child with the same name instead of creating a new one. */
  merge: boolean;
}

/** Add outline rows under `parent`. Returns the new doc and what happened to each row. */
export function applyOutline(doc: ProxyDoc, parent: NetAddr, rows: OutlineRow[], opts: ApplyOutlineOptions): { doc: ProxyDoc; plan: PlanRow[] } {
  let cur = doc;
  const plan: PlanRow[] = [];
  const stack: NetAddr[] = [parent];

  for (const row of rows) {
    const at = stack[row.depth];
    const where = `line ${row.line + 1} (“${row.name}”)`;
    if (depthOf(at) >= MAX_DEPTH) {
      throw new OpError(`${where}: too deep. RollCall proxy trees have at most ${MAX_DEPTH} levels.`);
    }

    let addr: NetAddr | undefined;
    let status: PlanRow['status'] = 'new';
    if (row.slot !== undefined) {
      const a = childAddr(at, row.slot)!;
      const named = cur.netNames.find((n) => n.addr === a);
      if (named && opts.merge && named.name === row.name) {
        addr = a;
        status = 'existing';
      } else if (named || [...usedAddrs(cur)].some((u) => inSubtree(u, a))) {
        const what = named ? `“${named.name}”` : 'another net';
        throw new OpError(`${where}: slot [${row.slot.toString(16).toUpperCase()}] under ${at} (${a}) is already used by ${what}`);
      } else {
        cur = insertNetName(cur, a, row.name);
        addr = a;
      }
    } else if (opts.merge) {
      addr = cur.netNames.find((n) => n.name === row.name && n.addr !== ROOT && parentOf(n.addr) === at && depthOf(n.addr) === depthOf(at) + 1)?.addr;
      if (addr) status = 'existing';
    }
    if (!addr) {
      try {
        const r = addChild(cur, at, row.name);
        cur = r.doc;
        addr = r.addr;
      } catch (e) {
        if (e instanceof OpError) throw new OpError(`${where}: ${e.message}`);
        throw e;
      }
    }

    let device: PlanRow['device'] = null;
    const [a1, a2, a3] = row.addrs;
    if (a1) {
      const finalAddr = addr;
      const dup = cur.ipShares.some((s) => s.net === finalAddr && s.ip1 === a1.ip);
      if (opts.merge && dup) {
        device = { ip: a1.ip, status: 'existing' };
      } else {
        cur = addIpShare(cur, addr, {
          ip1: a1.ip,
          port1: a1.port ?? opts.defaultPort,
          ip2: a2?.ip ?? '-',
          port2: a2?.port ?? opts.defaultPort,
          ip3: a3?.ip ?? '-',
          port3: a3?.port ?? opts.defaultPort,
        });
        device = { ip: a1.ip, status: 'new' };
      }
    }

    plan.push({ addr, name: row.name, depth: row.depth, status, device });
    stack[row.depth + 1] = addr;
    stack.length = row.depth + 2;
  }
  return { doc: cur, plan };
}

/**
 * Write a subtree as a tab-indented outline with tab-separated addresses,
 * ready to paste into Excel or back into the outline dialog. For the root,
 * its children are exported.
 */
export function exportOutline(doc: ProxyDoc, addr: NetAddr, defaultPort = '2050', opts: { slots?: boolean } = {}): string {
  const tree = buildTree(doc);
  const start = tree.byAddr.get(addr);
  if (!start) return '';
  const lines: string[] = [];
  const cell = (ip: string, port: string) => (ip === '-' ? '-' : port === defaultPort ? ip : `${ip}:${port}`);

  const walk = (node: TreeNode, depth: number) => {
    // With slots, every net below the exported top level keeps its exact slot.
    const slot = opts.slots && depth > 0 ? `[${childDigit(node.addr).toString(16).toUpperCase()}] ` : '';
    const indent = '\t'.repeat(depth) + slot;
    const name = node.named ? node.name : `Net ${node.addr}`;
    if (node.devices.length === 0) lines.push(indent + name);
    for (const i of node.devices) {
      const s = doc.ipShares[i];
      const cells = [cell(s.ip1, s.port1), cell(s.ip2, s.port2), cell(s.ip3, s.port3)];
      while (cells.length && cells[cells.length - 1] === '-') cells.pop();
      lines.push([indent + name, ...cells].join('\t'));
    }
    node.children.forEach((c) => walk(c, depth + 1));
  };

  if (addr === ROOT) start.children.forEach((c) => walk(c, 0));
  else walk(start, 0);
  return lines.join('\n');
}
