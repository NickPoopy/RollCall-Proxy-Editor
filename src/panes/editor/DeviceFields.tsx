import { isValidIp, isValidPort } from '../../model/validate';
import { hostProblem, resolveCidr, subnetOf, type Scheme } from '../../model/ipscheme';
import type { IpShare } from '../../model/types';
import { CommitInput } from './CommitInput';

/** IP fields accept a plain IP or a /30, /31 or /32 subnet (turned into the device address). */
export const checkIp = (optional: boolean) => (v: string) => {
  const s = v.trim();
  if (optional && (s === '-' || s === '')) return null;
  const r = resolveCidr(s);
  if (typeof r !== 'string') return r.error;
  if (isValidIp(r)) return null;
  return optional ? 'Enter an IPv4 address or subnet, or "-" for unused' : 'Enter an IPv4 address or subnet (e.g. 10.20.0.8/30)';
};
export const checkPort = (v: string) => (isValidPort(v) ? null : 'Enter a port from 1 to 65535');

/** Normalise what was typed into an IP field: subnets become the device address, blank becomes "-". */
export function normaliseIp(v: string, optional: boolean): string {
  const s = v.trim();
  if (s === '' && optional) return '-';
  const r = resolveCidr(s);
  return typeof r === 'string' ? r : s;
}

type Key = 'ip1' | 'port1' | 'ip2' | 'port2' | 'ip3' | 'port3';

/** The three address/port pairs of one IpShare. */
export function DeviceFields({ share, scheme = 'flat', onChange }: { share: IpShare; scheme?: Scheme; onChange: (k: Key, v: string) => void }) {
  return (
    <div className="device-fields">
      {([1, 2, 3] as const).map((n) => {
        const ipKey = `ip${n}` as Key;
        const portKey = `port${n}` as Key;
        const ip = share[ipKey];
        const net = scheme !== 'flat' && isValidIp(ip) ? subnetOf(ip, scheme) : null;
        const problem = scheme !== 'flat' && isValidIp(ip) ? hostProblem(ip, scheme) : null;
        return (
          <div className="addr-pair" key={n}>
            <label>Address {n}</label>
            <CommitInput
              className="ip"
              value={ip}
              placeholder={n === 1 ? '10.0.0.1 or 10.0.0.0/30' : '-'}
              check={checkIp(n !== 1)}
              onCommit={(v) => onChange(ipKey, normaliseIp(v, n !== 1))}
              aria-label={`Address ${n}`}
            />
            <span className="colon">:</span>
            <CommitInput
              className="port"
              value={share[portKey]}
              check={checkPort}
              onCommit={(v) => onChange(portKey, v.trim())}
              aria-label={`Port ${n}`}
            />
            {net && <span className={`subnet-note${problem ? ' sev-warning' : ''}`} title={problem ?? undefined}>{problem ? '⚠ ' : ''}{net}</span>}
          </div>
        );
      })}
    </div>
  );
}
