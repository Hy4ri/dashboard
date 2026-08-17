import fs from 'fs';
import { execFile } from 'child_process';

export const readFile = (filePath: string): Promise<string | null> =>
  new Promise(resolve =>
    fs.readFile(filePath, 'utf8', (e: NodeJS.ErrnoException | null, d?: string) =>
      resolve(e ? null : (d ?? null))
    )
  );

export const readDir = (dirPath: string): Promise<string[]> =>
  new Promise(resolve =>
    fs.readdir(dirPath, (e: NodeJS.ErrnoException | null, d?: string[]) =>
      resolve(e ? [] : (d ?? []))
    )
  );

export const runCmd = (cmd: string, args: string[] = [], tmo: number = 3000): Promise<string> =>
  new Promise(resolve =>
    execFile(cmd, args, { timeout: tmo }, (e: Error | null, o?: string) =>
      resolve(e ? '' : (o ? o.trim() : ''))
    )
  );
