import { prev } from '../state';
import { NetworkInterface } from '../../shared/types';

export interface RawNetDevEntry {
  rx: number;
  tx: number;
}

export interface RawNetDevMap {
  [iface: string]: RawNetDevEntry;
}

export interface NetworkInterfaceMap {
  [iface: string]: NetworkInterface;
}

export function parseProcNetDev(text: string): RawNetDevMap {
  const result: RawNetDevMap = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(wlan0|tun0)\s*:\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/);
    if (m) {
      result[m[1]] = { rx: parseInt(m[2], 10), tx: parseInt(m[3], 10) };
    }
  }
  return result;
}

export function collectNetwork(netText: string | null, interval: number): NetworkInterfaceMap {
  const netData = netText ? parseProcNetDev(netText) : {};
  const network: NetworkInterfaceMap = {};
  for (const iface of ['wlan0', 'tun0']) {
    const cur = netData[iface];
    if (!cur) continue;
    const p = prev.net?.[iface];
    const obj: NetworkInterface = { rx_bytes: cur.rx, tx_bytes: cur.tx };
    if (p && interval > 0) {
      obj.rx_rate = Math.round((cur.rx - p.rx) / interval);
      obj.tx_rate = Math.round((cur.tx - p.tx) / interval);
    } else {
      obj.rx_rate = 0;
      obj.tx_rate = 0;
    }
    network[iface] = obj;
  }
  prev.net = netData;
  return network;
}
