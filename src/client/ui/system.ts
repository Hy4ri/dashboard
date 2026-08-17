import { SystemData } from '../../shared/types.js';

export function renderSystem(sys?: SystemData | null): void {
  if (!sys || !sys.hostname) return;
  document.title = 'Dashboard — ' + sys.hostname;
}
