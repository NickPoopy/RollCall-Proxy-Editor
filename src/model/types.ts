/** A 4-hex-digit RollCall net address, always stored upper-case, e.g. "1210". */
export type NetAddr = string;

export interface NetName {
  addr: NetAddr;
  name: string;
}

/**
 * One `IpShareN=` line: attaches a device reachable at up to three IP/port
 * pairs to a leaf net. "-" means an address slot is unused.
 */
export interface IpShare {
  ip1: string;
  port1: string;
  net: NetAddr;
  ip2: string;
  port2: string;
  ip3: string;
  port3: string;
  /** Any fields after the 7 known ones, kept verbatim. */
  extra: string[];
  /** Whether the line ends with a trailing comma (RollCall writes one). */
  trailingComma: boolean;
}

/** An entry inside a section, in file order. */
export type Entry =
  | { type: 'kv'; key: string; value: string }
  /** Blank lines, comments or anything we don't understand, kept verbatim. */
  | { type: 'raw'; text: string }
  /** Marks where the IpShare block is written. */
  | { type: 'ipshares' }
  /** Marks where the NetNames entries are written. */
  | { type: 'netnames' };

export interface Section {
  /** null for lines before the first section header. */
  name: string | null;
  /** The header line exactly as written, e.g. "[NetNames]". */
  header: string | null;
  entries: Entry[];
}

export interface ProxyDoc {
  sections: Section[];
  netNames: NetName[];
  ipShares: IpShare[];
  eol: '\r\n' | '\n';
  trailingNewline: boolean;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** 0-based line in the text this came from, when known. */
  line?: number;
  addr?: NetAddr;
  ipShareIndex?: number;
}

/** Where things live in the text, for jump-to-line and lint markers. */
export interface LineIndex {
  /** addr -> 0-based line numbers of its NetNames entries. */
  netNames: Map<NetAddr, number[]>;
  /** IpShare index (file order) -> 0-based line number. */
  ipShares: number[];
}

export interface ParseResult {
  doc: ProxyDoc;
  diagnostics: Diagnostic[];
  lineIndex: LineIndex;
}

export const NETNAMES_SECTION = 'NetNames';
export const IPSHARE_SECTION = 'Combiner Services';
