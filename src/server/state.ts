import http from 'http';
import {
  DashboardState,
  PM2Process,
  ThermalSensor,
  CpuFrequency,
  DiskUsage,
  TorrentItem,
  ConnectivityStatus,
} from '../shared/types';

export interface PrevCpuData {
  overall: { total: number; idle: number } | null;
  cores: Record<string, { total: number; idle: number }>;
}

export interface PrevState {
  cpu: PrevCpuData | null;
  net: Record<string, { rx: number; tx: number }> | null;
  disk: Record<string, any> | null;
  time: number;
}

export interface StaticSystemInfo {
  hostname: string | null;
  ip: string | null;
  kernel: string | null;
  os: string | null;
  arch: string | null;
}

export interface ThermalPathItem {
  name: string;
  path: string;
}

export interface CpuStaticInfoItem {
  core: number;
  min: number | null;
  max: number | null;
  governor: string | null;
}

export interface CacheEntry<T> {
  value: T | null;
  time: number;
}

export const state: DashboardState = {};

export const prev: PrevState = {
  cpu: null,
  net: null,
  disk: null,
  time: 0,
};

export const stateModule = {
  state,
  prev,
  pollTimer: null as NodeJS.Timeout | null,
  lastRequestTime: Date.now(),
  server: null as http.Server | null,
  diskCache: { value: null, time: 0 } as CacheEntry<DiskUsage>,
  pm2Cache: { value: null, time: 0 } as CacheEntry<PM2Process[]>,
  freqCache: { value: null, time: 0 } as CacheEntry<CpuFrequency[]>,
  thermalCache: { value: null, time: 0 } as CacheEntry<ThermalSensor[]>,
  qbCache: { value: null, time: 0 } as CacheEntry<TorrentItem[]>,
  connectivityCache: { value: null, time: 0 } as CacheEntry<{ internet: ConnectivityStatus; dns: ConnectivityStatus }>,
  staticSystem: null as StaticSystemInfo | null,
  thermalPaths: [] as ThermalPathItem[],
  cpuStaticInfo: [] as CpuStaticInfoItem[],
  qbCookie: null as string | null,
  QB_HOST: 'localhost',
  QB_PORT: 7777,
  QB_USER: 'admin',
  QB_PASS: null as string | null,
};

export default stateModule;
