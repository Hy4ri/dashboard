import { prev } from '../state';
import { DiskIOItem } from '../../shared/types';

export interface RawDiskEntry {
  reads: number;
  writes: number;
  sectorsRead: number;
  sectorsWritten: number;
  ioTime: number;
}

export interface RawDiskMap {
  [name: string]: RawDiskEntry;
}

export interface DiskIOMap {
  [dev: string]: DiskIOItem;
}

export function parseProcDiskStats(text: string): RawDiskMap {
  const result: RawDiskMap = {};
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 14) continue;
    const name = parts[2];
    if (name === 'sda' || name === 'sda26' || name === 'zram0') {
      result[name] = {
        reads: parseInt(parts[3], 10),
        writes: parseInt(parts[7], 10),
        sectorsRead: parseInt(parts[5], 10),
        sectorsWritten: parseInt(parts[9], 10),
        ioTime: parseInt(parts[12], 10),
      };
    }
  }
  return result;
}

export function collectDiskIO(diskText: string | null, interval: number): DiskIOMap {
  const diskData = diskText ? parseProcDiskStats(diskText) : {};
  const io: DiskIOMap = {};
  for (const dev of ['sda', 'sda26', 'zram0']) {
    const cur = diskData[dev];
    if (!cur) continue;
    const p = prev.disk?.[dev];
    const obj: DiskIOItem = {
      reads: cur.reads,
      writes: cur.writes,
      sectorsRead: cur.sectorsRead,
      sectorsWritten: cur.sectorsWritten,
      ioTime: cur.ioTime,
    };
    if (p && interval > 0) {
      obj.readsPerSec = Math.round((cur.reads - p.reads) / interval);
      obj.writesPerSec = Math.round((cur.writes - p.writes) / interval);
      obj.sectorsReadPerSec = Math.round((cur.sectorsRead - p.sectorsRead) / interval);
      obj.sectorsWrittenPerSec = Math.round((cur.sectorsWritten - p.sectorsWritten) / interval);
    } else {
      obj.readsPerSec = 0;
      obj.writesPerSec = 0;
      obj.sectorsReadPerSec = 0;
      obj.sectorsWrittenPerSec = 0;
    }
    io[dev] = obj;
  }
  prev.disk = diskData;
  return io;
}
