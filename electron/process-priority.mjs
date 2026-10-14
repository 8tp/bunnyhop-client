import os from 'node:os';

/* Windows priority for the processes a frame passes through: the browser
   process (input routing), the GPU process (presentation) and the game
   window's renderer (the game itself). Child processes start at Normal
   whatever the browser process runs at, so each one is raised by pid. */
export const PRIORITY_CLASSES = Object.freeze({
  normal: os.constants.priority.PRIORITY_NORMAL,
  'above-normal': os.constants.priority.PRIORITY_ABOVE_NORMAL,
});

export function priorityTargets(metrics = [], gamePid = 0) {
  return metrics
    .filter((m) => Number.isInteger(m?.pid) && m.pid > 0 && (m.type === 'Browser' || m.type === 'GPU' || (gamePid > 0 && m.pid === gamePid)))
    .map((m) => m.pid);
}

export function applyPriority({ priority, metrics, gamePid, platform = process.platform, setPriority = os.setPriority }) {
  if (platform !== 'win32' || !Object.hasOwn(PRIORITY_CLASSES, priority) || priority === 'normal') return [];
  const raised = [];
  for (const pid of priorityTargets(metrics, gamePid)) {
    try {
      setPriority(pid, PRIORITY_CLASSES[priority]);
      raised.push(pid);
    } catch (error) {
      console.warn('[client] could not raise process priority', pid, error.message);
    }
  }
  return raised;
}
