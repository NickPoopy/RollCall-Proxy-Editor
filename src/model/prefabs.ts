import { childDigit } from './address';
import { suggestRename } from './bulk';
import { renderTemplate, type Value, type Vars } from './template';
import { buildTree, labelOf, type TreeNode } from './tree';
import type { NetAddr, ProxyDoc } from './types';
import { isValidIp } from './validate';

export type ParamType = 'int' | 'text' | 'ip' | 'bool';

export interface PrefabParam {
  key: string;
  label: string;
  type: ParamType;
  default: Value;
  min?: number;
  max?: number;
  hint?: string;
}

export interface Prefab {
  id: string;
  name: string;
  description: string;
  params: PrefabParam[];
  /** Outline template; see template.ts for the syntax. */
  body: string;
  builtin?: boolean;
}

export function defaultValues(p: Prefab): Vars {
  return Object.fromEntries(p.params.map((x) => [x.key, x.default]));
}

/** Check one setting value. Returns an error message or null. */
export function checkParam(p: PrefabParam, v: Value): string | null {
  if (p.type === 'int') {
    const n = Number(v);
    if (!Number.isInteger(n)) return `${p.label}: enter a whole number`;
    if (p.min !== undefined && n < p.min) return `${p.label}: at least ${p.min}`;
    if (p.max !== undefined && n > p.max) return `${p.label}: at most ${p.max}`;
  }
  if (p.type === 'ip') {
    const s = String(v).trim();
    if (s !== '' && s !== '-' && !isValidIp(s)) return `${p.label}: enter an IPv4 address, or "-" for none`;
  }
  return null;
}

/** Render a prefab with the given settings to outline text. Throws TemplateError. */
export function renderPrefab(p: Prefab, values: Vars): string {
  const vars: Vars = {};
  for (const param of p.params) {
    const v = values[param.key] ?? param.default;
    vars[param.key] = param.type === 'int' ? Number(v) : param.type === 'bool' ? Boolean(v) : String(v);
  }
  // Drop trailing unused-address cells so the outline stays readable.
  return renderTemplate(p.body, vars)
    .split('\n')
    .map((l) => l.replace(/(\t-)+$/, ''))
    .join('\n');
}

// =====================================================================
// Built-in prefabs, modelled on a typical truck proxy
// =====================================================================

export const BUILTIN_PREFABS: Prefab[] = [
  {
    id: 'builtin-iq-frames',
    builtin: true,
    name: 'IQ frames + cards',
    description: 'Frames (Frame 01…) each holding cards (F1 IQUCP25_03…). Each card sits in the slot matching its card number. Add under a folder like “UCP25”.',
    params: [
      { key: 'frames', label: 'Frames', type: 'int', default: 2, min: 1, max: 15 },
      { key: 'firstFrame', label: 'First frame number', type: 'int', default: 1, min: 1, max: 15, hint: 'Also the frame’s slot' },
      { key: 'firstCard', label: 'First card', type: 'int', default: 1, min: 1, max: 15 },
      { key: 'lastCard', label: 'Last card', type: 'int', default: 10, min: 1, max: 15 },
      { key: 'cardType', label: 'Card name', type: 'text', default: 'IQUCP25' },
      { key: 'ipA', label: 'Address 1 of card 1', type: 'ip', default: '10.100.82.10', hint: 'Card n gets +(n−1)' },
      { key: 'ipB', label: 'Address 2 of card 1', type: 'ip', default: '10.100.83.10', hint: '“-” for none' },
      { key: 'frameStep', label: 'IP step per frame', type: 'int', default: 10 },
    ],
    body: [
      '@repeat f 0..frames-1',
      '[{{hex(firstFrame+f)}}] Frame {{pad(firstFrame+f, 2)}}',
      '@repeat c firstCard..lastCard',
      '\t[{{hex(c)}}] F{{firstFrame+f}} {{cardType}}_{{pad(c, 2)}}\t{{ip(ipA, f*frameStep + c-1)}}\t{{ip(ipB, f*frameStep + c-1)}}',
      '@end',
      '@end',
    ].join('\n'),
  },
  {
    id: 'builtin-multiviewer',
    builtin: true,
    name: 'Multiviewers',
    description: 'MV1, MV2… each with “MV Control” and IP Control Port 1–n. Add under a folder like “IP MVs”.',
    params: [
      { key: 'count', label: 'Multiviewers', type: 'int', default: 4, min: 1, max: 15 },
      { key: 'first', label: 'First number', type: 'int', default: 1, min: 0 },
      { key: 'prefix', label: 'Name', type: 'text', default: 'MV', hint: 'Number is added after it' },
      { key: 'ports', label: 'IP control ports each', type: 'int', default: 4, min: 0, max: 14 },
      { key: 'ip', label: 'MV Control IP (first MV)', type: 'ip', default: '10.10.82.10', hint: 'Ports follow at +1, +2…' },
      { key: 'ip2', label: 'Address 2 (first MV)', type: 'ip', default: '-', hint: '“-” for none' },
      { key: 'step', label: 'IP step per MV', type: 'int', default: 10 },
    ],
    body: [
      '@repeat m 0..count-1',
      '{{prefix}}{{first+m}}',
      '\tMV Control\t{{ip(ip, m*step)}}\t{{ip(ip2, m*step)}}',
      '@repeat p 1..ports',
      '\tIP Control Port {{p}}\t{{ip(ip, m*step + p)}}\t{{ip(ip2, m*step + p)}}',
      '@end',
      '@end',
    ].join('\n'),
  },
  {
    id: 'builtin-mv-media-ports',
    builtin: true,
    name: 'MV media ports',
    description: 'MV1, MV2… each with Port 1–n and two addresses per port. Add under a folder like “MV Media Ports”.',
    params: [
      { key: 'count', label: 'Multiviewers', type: 'int', default: 4, min: 1, max: 15 },
      { key: 'first', label: 'First number', type: 'int', default: 1, min: 0 },
      { key: 'prefix', label: 'Name', type: 'text', default: 'MV' },
      { key: 'ports', label: 'Ports each', type: 'int', default: 4, min: 1, max: 15 },
      { key: 'ipA', label: 'Address 1 of Port 1 (first MV)', type: 'ip', default: '10.100.80.11' },
      { key: 'ipB', label: 'Address 2 of Port 1 (first MV)', type: 'ip', default: '10.100.81.10', hint: '“-” for none' },
      { key: 'step', label: 'IP step per MV', type: 'int', default: 10 },
    ],
    body: [
      '@repeat m 0..count-1',
      '{{prefix}}{{first+m}}',
      '@repeat p 1..ports',
      '\t[{{hex(p)}}] Port {{p}}\t{{ip(ipA, m*step + p-1)}}\t{{ip(ipB, m*step + p-1)}}',
      '@end',
      '@end',
    ].join('\n'),
  },
];

// =====================================================================
// Make a prefab from an existing branch
// =====================================================================

/**
 * Turn a branch into a reusable prefab:
 * - a number at the end of the branch name becomes "how many" + "first number"
 * - each distinct first-three-octets network becomes a setting
 * - every copy shifts its IPs by a step
 * - children keep their exact slots
 */
export function prefabFromBranch(doc: ProxyDoc, addr: NetAddr, defaultPort = '2050'): Prefab {
  const tree = buildTree(doc);
  const root = tree.byAddr.get(addr);
  if (!root) throw new Error(`No net at ${addr}`);
  const rootName = labelOf(root);
  const sug = suggestRename(rootName);
  const m = /^(.*?)(\d+)(\D*)$/.exec(rootName);

  // Collect networks (first three octets) and the spread of last octets.
  const nets: string[] = [];
  const lastOctets: number[] = [];
  const walkIps = (n: TreeNode) => {
    for (const i of n.devices) {
      const s = doc.ipShares[i];
      for (const ip of [s.ip1, s.ip2, s.ip3]) {
        if (!isValidIp(ip)) continue;
        const pre = ip.split('.').slice(0, 3).join('.');
        if (!nets.includes(pre)) nets.push(pre);
        lastOctets.push(Number(ip.split('.')[3]));
      }
    }
    n.children.forEach(walkIps);
  };
  walkIps(root);
  const range = lastOctets.length ? Math.max(...lastOctets) - Math.min(...lastOctets) : 0;
  const step = [10, 20, 50, 100].find((s) => s > range) ?? 0;

  const params: PrefabParam[] = [];
  let nameExpr = rootName;
  if (sug && m) {
    const [, pre, num, post] = m;
    const width = num.length > 1 && num.startsWith('0') ? num.length : 0;
    params.push({ key: 'count', label: 'How many', type: 'int', default: 1, min: 1, max: 15 });
    params.push({ key: 'first', label: 'First number', type: 'int', default: Number(num), min: 0 });
    params.push({ key: 'prefix', label: 'Name', type: 'text', default: pre, hint: 'Number is added after it' });
    nameExpr = `{{prefix}}{{${width ? `pad(first+k, ${width})` : 'first+k'}}}${post}`;
  } else {
    params.push({ key: 'name', label: 'Name', type: 'text', default: rootName });
    nameExpr = '{{name}}';
  }
  nets.forEach((n, i) =>
    params.push({ key: `net${i + 1}`, label: `Network ${i + 1}`, type: 'text', default: n, hint: 'First three octets, e.g. 10.10.82' }),
  );
  const offset = sug ? 'k*step' : '0';
  if (sug && nets.length) params.push({ key: 'step', label: 'IP step per copy', type: 'int', default: step });

  const ipExpr = (ip: string, port: string) => {
    if (!isValidIp(ip)) return '-';
    const parts = ip.split('.');
    const i = nets.indexOf(parts.slice(0, 3).join('.'));
    return `{{ip(net${i + 1} + '.${parts[3]}', ${offset})}}${port === defaultPort ? '' : `:${port}`}`;
  };
  const escapeName = (s: string) => s.split(rootName).join(nameExpr);

  const lines: string[] = [];
  const walk = (n: TreeNode, depth: number) => {
    const slot = depth > 0 ? `[${childDigit(n.addr).toString(16).toUpperCase()}] ` : '';
    const name = depth === 0 ? nameExpr : escapeName(labelOf(n));
    const head = '\t'.repeat(depth) + slot + name;
    if (n.devices.length === 0) lines.push(head);
    for (const i of n.devices) {
      const s = doc.ipShares[i];
      const cells = [ipExpr(s.ip1, s.port1), ipExpr(s.ip2, s.port2), ipExpr(s.ip3, s.port3)];
      while (cells.length && cells[cells.length - 1] === '-') cells.pop();
      lines.push([head, ...cells].join('\t'));
    }
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);

  const body = sug ? ['@repeat k 0..count-1', ...lines, '@end'].join('\n') : lines.join('\n');
  return {
    id: `custom-${Date.now().toString(36)}`,
    name: sug ? `${m![1].trim() || rootName} block` : rootName,
    description: `Made from “${rootName}” (${addr}).`,
    params,
    body,
  };
}

/** Basic shape check for imported prefabs. */
export function isPrefab(x: unknown): x is Prefab {
  const p = x as Prefab;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.body === 'string' &&
    Array.isArray(p.params) &&
    p.params.every((q) => typeof q.key === 'string' && typeof q.label === 'string' && ['int', 'text', 'ip', 'bool'].includes(q.type))
  );
}
