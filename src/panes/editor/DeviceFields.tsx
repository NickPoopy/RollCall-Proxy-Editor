import { isValidIp, isValidPort } from '../../model/validate';
import type { IpShare } from '../../model/types';
import { CommitInput } from './CommitInput';

export const checkIp = (optional: boolean) => (v: string) =>
  (optional && v === '-') || isValidIp(v) ? null : optional ? 'Enter an IPv4 address, or "-" for unused' : 'Enter an IPv4 address';
export const checkPort = (v: string) => (isValidPort(v) ? null : 'Enter a port from 1 to 65535');

type Key = 'ip1' | 'port1' | 'ip2' | 'port2' | 'ip3' | 'port3';

/** The three address/port pairs of one IpShare. */
export function DeviceFields({ share, onChange }: { share: IpShare; onChange: (k: Key, v: string) => void }) {
  return (
    <div className="device-fields">
      {([1, 2, 3] as const).map((n) => {
        const ipKey = `ip${n}` as Key;
        const portKey = `port${n}` as Key;
        return (
          <div className="addr-pair" key={n}>
            <label>Address {n}</label>
            <CommitInput
              className="ip"
              value={share[ipKey]}
              placeholder={n === 1 ? '10.0.0.1' : '-'}
              check={checkIp(n !== 1)}
              onCommit={(v) => onChange(ipKey, v.trim() || (n === 1 ? v : '-'))}
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
          </div>
        );
      })}
    </div>
  );
}
