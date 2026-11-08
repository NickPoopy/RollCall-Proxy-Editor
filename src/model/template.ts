import { incrementIp } from './ops';
import { isValidIp } from './validate';

/**
 * A tiny template language for prefab outlines.
 *
 *   {{expr}}                      inserts a value
 *   @repeat VAR FROM..TO          repeats the lines up to the matching @end
 *   @if EXPR                      keeps the lines up to the matching @end if EXPR is true
 *   @end
 *
 * Expressions: numbers, 'strings', settings and loop variables, + - * / %,
 * comparisons, ( ), and the functions
 *   pad(n, width)   zero-pad: pad(3, 2) = "03"
 *   hex(n)          hex digit: hex(10) = "A"
 *   ip(base, off)   add off to an IP's last octet (carrying); "-" or "" stays "-"
 * '+' joins text when either side is text.
 */

export type Value = number | string | boolean;
export type Vars = Record<string, Value>;

export class TemplateError extends Error {}

// ---------------- Expression evaluator ----------------

type Tok = { t: 'num'; v: number } | { t: 'str'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/\d/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      toks.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i))!;
      toks.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new TemplateError('Unclosed quote');
      toks.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
    } else {
      const two = src.slice(i, i + 2);
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) {
        toks.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/%()<>,!'.includes(c)) {
        toks.push({ t: 'op', v: c });
        i++;
      } else {
        throw new TemplateError(`Unexpected "${c}"`);
      }
    }
  }
  return toks;
}

const FUNCS: Record<string, (...a: Value[]) => Value> = {
  pad: (n, w) => String(n).padStart(Number(w ?? 2), '0'),
  hex: (n) => {
    const v = Number(n);
    if (!Number.isInteger(v) || v < 0 || v > 15) throw new TemplateError(`hex(${n}): needs a whole number 0–15`);
    return v.toString(16).toUpperCase();
  },
  ip: (base, off) => {
    const b = String(base ?? '').trim();
    if (b === '' || b === '-') return '-';
    if (!isValidIp(b)) throw new TemplateError(`ip(): "${b}" is not an IP address`);
    return incrementIp(b, Number(off ?? 0));
  },
};

export function evaluate(expr: string, vars: Vars): Value {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new TemplateError(`Expected "${v}" in {{${expr}}}`);
    p++;
  };

  const num = (v: Value) => {
    const n = typeof v === 'boolean' ? Number(v) : Number(v);
    if (Number.isNaN(n)) throw new TemplateError(`"${v}" is not a number`);
    return n;
  };

  const primary = (): Value => {
    const t = toks[p++];
    if (!t) throw new TemplateError(`Unexpected end of {{${expr}}}`);
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = or();
      expect(')');
      return v;
    }
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (isOp('(')) {
        p++;
        const args: Value[] = [];
        if (!isOp(')')) {
          args.push(or());
          while (isOp(',')) {
            p++;
            args.push(or());
          }
        }
        expect(')');
        const f = FUNCS[t.v];
        if (!f) throw new TemplateError(`Unknown function ${t.v}()`);
        return f(...args);
      }
      if (!(t.v in vars)) throw new TemplateError(`Unknown setting "${t.v}"`);
      return vars[t.v];
    }
    throw new TemplateError(`Unexpected "${t.v}" in {{${expr}}}`);
  };
  const unary = (): Value => {
    if (isOp('-')) {
      p++;
      return -num(unary());
    }
    if (isOp('!')) {
      p++;
      return !unary();
    }
    return primary();
  };
  const mul = (): Value => {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = toks[p++].v;
      const r = num(unary());
      v = op === '*' ? num(v) * r : op === '/' ? Math.floor(num(v) / r) : num(v) % r;
    }
    return v;
  };
  const add = (): Value => {
    let v = mul();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      const r = mul();
      if (op === '+' && (typeof v === 'string' || typeof r === 'string')) v = String(v) + String(r);
      else v = op === '+' ? num(v) + num(r) : num(v) - num(r);
    }
    return v;
  };
  const cmp = (): Value => {
    const l = add();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (isOp(op)) {
        p++;
        const r = add();
        const [a, b] = typeof l === 'number' || typeof r === 'number' ? [num(l), num(r)] : [String(l), String(r)];
        return op === '==' ? a === b : op === '!=' ? a !== b : op === '<=' ? a <= b : op === '>=' ? a >= b : op === '<' ? a < b : a > b;
      }
    }
    return l;
  };
  const and = (): Value => {
    let v = cmp();
    while (isOp('&&')) {
      p++;
      const r = cmp();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  };
  const or = (): Value => {
    let v = and();
    while (isOp('||')) {
      p++;
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  };

  const v = or();
  if (p < toks.length) throw new TemplateError(`Unexpected "${(toks[p] as Tok).v}" in {{${expr}}}`);
  return v;
}

// ---------------- Line renderer ----------------

const MAX_LINES = 5000;

interface Block {
  kind: 'line' | 'repeat' | 'if';
  text: string;
  line: number;
  children: Block[];
}

function buildBlocks(lines: string[]): Block[] {
  const root: Block = { kind: 'if', text: 'true', line: -1, children: [] };
  const stack: Block[] = [root];
  lines.forEach((l, i) => {
    const t = l.trim();
    const top = stack[stack.length - 1];
    if (t.startsWith('@repeat ') || t.startsWith('@if ')) {
      const kind = t.startsWith('@repeat') ? 'repeat' : 'if';
      const b: Block = { kind, text: t.slice(kind === 'repeat' ? 8 : 4).trim(), line: i, children: [] };
      top.children.push(b);
      stack.push(b);
    } else if (t === '@end') {
      if (stack.length === 1) throw new TemplateError(`Line ${i + 1}: @end without @repeat or @if`);
      stack.pop();
    } else if (t.startsWith('@')) {
      throw new TemplateError(`Line ${i + 1}: unknown directive "${t.split(/\s/)[0]}"`);
    } else {
      top.children.push({ kind: 'line', text: l, line: i, children: [] });
    }
  });
  if (stack.length > 1) throw new TemplateError(`Line ${stack[stack.length - 1].line + 1}: missing @end`);
  return root.children;
}

/** Render a prefab body to outline text. Throws TemplateError with a line number. */
export function renderTemplate(body: string, vars: Vars): string {
  const blocks = buildBlocks(body.split(/\r?\n/));
  const out: string[] = [];

  const at = (line: number, f: () => void) => {
    try {
      f();
    } catch (e) {
      if (e instanceof TemplateError && !/^Line \d+:/.test(e.message)) throw new TemplateError(`Line ${line + 1}: ${e.message}`);
      throw e;
    }
  };

  const run = (bs: Block[], scope: Vars) => {
    for (const b of bs) {
      if (b.kind === 'line') {
        at(b.line, () => out.push(b.text.replace(/\{\{(.*?)\}\}/g, (_m, e: string) => String(evaluate(e, scope)))));
        if (out.length > MAX_LINES) throw new TemplateError(`More than ${MAX_LINES} lines generated`);
      } else if (b.kind === 'if') {
        let ok = false;
        at(b.line, () => (ok = Boolean(evaluate(b.text, scope))));
        if (ok) run(b.children, scope);
      } else {
        let name = '';
        let from = 0;
        let to = -1;
        at(b.line, () => {
          const m = /^([A-Za-z_]\w*)\s+(.+?)\.\.(.+)$/.exec(b.text);
          if (!m) throw new TemplateError('Use "@repeat name FROM..TO", e.g. @repeat i 1..count');
          name = m[1];
          from = Number(evaluate(m[2], scope));
          to = Number(evaluate(m[3], scope));
          if (!Number.isFinite(from) || !Number.isFinite(to)) throw new TemplateError('Repeat range must be numbers');
          if (to - from > 1000) throw new TemplateError('Repeat range is too large (max 1000)');
        });
        for (let i = from; i <= to; i++) run(b.children, { ...scope, [name]: i });
      }
    }
  };

  run(blocks, vars);
  return out.join('\n');
}
