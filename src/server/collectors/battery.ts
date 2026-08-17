import { readFile } from '../utils/helpers';
import { BatteryData } from '../../shared/types';

export async function collectBattery(): Promise<BatteryData> {
  const base = '/sys/class/power_supply/battery';
  const [cap, status, volt, curr] = await Promise.all([
    readFile(`${base}/capacity`),
    readFile(`${base}/status`),
    readFile(`${base}/voltage_now`),
    readFile(`${base}/current_now`),
  ]);
  return {
    capacity: cap ? parseInt(cap.trim(), 10) : null,
    status: status ? status.trim() : null,
    voltage: volt ? parseInt(volt.trim(), 10) : null,
    current: curr ? parseInt(curr.trim(), 10) : null,
  };
}
