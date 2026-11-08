import exampleText from '../../samples/example-proxy.txt?raw';

export const EXAMPLE_TEXT = exampleText;

/** Starting point for a brand-new proxy file. Same section layout as a RollCall-written file. */
export const NEW_TEMPLATE = [
  '[Combiner Services]',
  'broadcast_iam=1',
  'ControlPort=2050',
  'LogPort=2053',
  'SwitchToHighestPriority=1',
  'Client0=*.*.*.*,1,1',
  '[LogNames]',
  '[MonitoringToLogServer]',
  'UnitName=NEW_PROXY',
  'ConfigVersion=N/U',
  'LogServerIP=127.0.0.1',
  'LogServerPort=2056',
  'UnitAddress=0000:01:01',
  '[NetNames]',
  '0000=New Proxy',
  '[UI]',
  'Theme=0',
  '',
].join('\r\n');
