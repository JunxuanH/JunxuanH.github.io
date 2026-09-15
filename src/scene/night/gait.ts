/** Locomotion decisions shared by the player and deterministic regression checks. */
export type Gait = 'idle' | 'walk' | 'run';
export const WALK_SPEED = 1.8;
export const RUN_SPEED = 4.8;

export function gaitForSpeed(speed: number, previous: Gait): Gait {
  // Separate entry/exit thresholds avoid animation chatter with a thumbstick or against walls.
  if (speed < (previous === 'idle' ? .16 : .08)) return 'idle';
  return speed > (previous === 'run' ? 1.95 : 2.2) ? 'run' : 'walk';
}

export function gaitRate(speed: number, stride: number): number {
  // Do not force a minimum cadence: slowly moving feet must not shuffle faster than the player.
  return Math.min(2.2, Math.max(0, speed) / Math.max(.01, stride));
}

export function gaitPhase(time: number, duration: number, nextDuration: number): number {
  return duration > 0 ? ((time % duration + duration) % duration) / duration * nextDuration : 0;
}
