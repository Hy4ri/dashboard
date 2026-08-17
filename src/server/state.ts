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
import { RawDiskMap } from './parsers/disk';
import { RawNetDevMap } from './parsers/network';

export interface PrevCpuData {
  overall: { total: number; idle: number } | null;
  cores: Record<string, { total: number; idle: number }>;
}

export interface PrevState {
  cpu: PrevCpuData | null;
  net: RawNetDevMap | null;
  disk: RawDiskMap | null;
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

export interface StateModule {
  state: DashboardState;
  prev: PrevState;
  pollTimer: NodeJS.Timeout | null;
  lastRequestTime: number;
  server: http.Server | null;
  diskCache: CacheEntry<DiskUsage>;
  pm2Cache: CacheEntry<PM2Process[]>;
  freqCache: CacheEntry<CpuFrequency[]>;
  thermalCache: CacheEntry<ThermalSensor[]>;
  qbCache: CacheEntry<TorrentItem[]>;
  connectivityCache: CacheEntry<{ internet: ConnectivityStatus; dns: ConnectivityStatus }>;
  staticSystem: StaticSystemInfo | null;
  thermalPaths: ThermalPathItem[];
  cpuStaticInfo: CpuStaticInfoItem[];
  qbCookie: string | null;
  QB_HOST: string;
  QB_PORT: number;
  QB_USER: string;
  QB_PASS: string | null;
}

export const state: DashboardState = {};

export const prev: PrevState = {
  cpu: null,
  net: null,
  disk: null,
  time: 0,
};

export const stateModule: StateModule = {
  state,
  prev,
  pollTimer: null,
  lastRequestTime: Date.now(),
  server: null,
  diskCache: { value: null, time: 0 },
  pm2Cache: { value: null, time: 0 },
  freqCache: { value: null, time: 0 },
  thermalCache: { value: null, time: 0 },
  qbCache: { value: null, time: 0 },
  connectivityCache: { value: null, time: 0 },
  staticSystem: null,
  thermalPaths: [],
  cpuStaticInfo: [],
  qbCookie: null,
  QB_HOST: 'localhost',
  QB_PORT: 7777,
  QB_USER: 'admin',
  QB_PASS: null,
};

export default stateModule;
