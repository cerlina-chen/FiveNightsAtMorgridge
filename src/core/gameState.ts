import type { Cam, GameEvent, RunConfig, SentinelNode, Side, TaskDef, TaskId, TaskKind, Unit } from './types';
import {
  attackWindowMs, camFor, doorCam, doorTaskSide, dueF, FINAL_ATTACK_F, nodeAt, sentinelPlans, type SentinelStep,
} from './sentinel';
import { buildEvent, selfCorrect, type ActiveTask, type SelfAnswer, type Truths } from './tasks';

/** Things the presentation layer may want to react to (sound, flashes). Core never plays them. */
export type Signal = 'task' | 'resolve' | 'door' | 'static' | 'steps' | 'floor' | 'powerout' | 'caught' | 'survived';

export interface Resolution {
  taskId: TaskId;
  kind: TaskKind;
  how: 'accept' | 'self';
}

type Attack = { state: 'pending' | 'active' | 'done'; endsAtMs: number };

export interface GameState {
  cfg: RunConfig;
  tasks: TaskDef[];
  truths: Truths;
  nightMinutes: number;
  nightMs: number;
  /** Night clock. It never stops: a task has no timer, but the building keeps moving while you decide. */
  elapsedMs: number;
  phase: 'playing' | 'ended';
  outcome: 'survived' | 'caught' | null;
  caughtAt: string | null;
  caughtBy: Unit | null;
  floor: 1 | 2;
  power: number;
  powerOutAtMs: number | null;
  doors: Record<Side, boolean>;
  /** null = the building map. */
  cam: Cam | null;
  plans: Record<Unit, SentinelStep[]>;
  sentinels: Record<Unit, SentinelNode>;
  /** Black unit at a door (the door task). */
  blackAttack: Attack;
  /** White unit at a door near 2:00 AM. */
  finalAttack: Attack;
  task: ActiveTask | null;
  nextTask: number;
  lastResolution: Resolution | null;
  events: GameEvent[];
}

// Tuning. Rates are per in-game minute so both shift lengths drain the same per night.
export const NIGHT_MS = { judge: 180_000, full: 300_000 } as const;
/** Night 1: both doors sealed from 12:00 to 2:00 still leaves power. Each later night drains 35% faster. */
const DOOR_DRAIN = 0.48;
const powerScale = (night: number): number => 1 + (night - 1) * 0.35;
/** With the power out the doors open, and something arrives this many ms later. */
const POWER_OUT_GRACE_MS = 3000;

export function createGame(cfg: RunConfig, tasks: TaskDef[], nightMinutes: number, truths: Truths): GameState {
  const plans = sentinelPlans(cfg, tasks, nightMinutes);
  return {
    cfg, tasks, truths, nightMinutes,
    nightMs: NIGHT_MS[cfg.mode],
    elapsedMs: 0,
    phase: 'playing', outcome: null, caughtAt: null, caughtBy: null,
    floor: 1, power: 100, powerOutAtMs: null,
    doors: { L: false, R: false },
    cam: null,
    plans, sentinels: { black: plans.black[0].node, white: plans.white[0].node },
    blackAttack: { state: 'pending', endsAtMs: 0 },
    finalAttack: { state: 'pending', endsAtMs: 0 },
    task: null, nextTask: 0, lastResolution: null, events: [],
  };
}

export const fraction = (s: GameState): number => Math.min(1, s.elapsedMs / s.nightMs);

export function clockLabel(s: GameState): string {
  const total = Math.min(s.nightMinutes, Math.floor(fraction(s) * s.nightMinutes));
  const hour = total < 60 ? 12 : total < 120 ? 1 : 2;
  return `${hour}:${String(total % 60).padStart(2, '0')} AM`;
}

const dueMs = (s: GameState, i: number): number => (s.tasks[i].atMin / s.nightMinutes) * s.nightMs;

/** Units a camera can see right now. */
export function unitsOn(s: GameState, cam: Cam): Unit[] {
  return (['black', 'white'] as Unit[]).filter((u) => camFor(s.sentinels[u]) === cam);
}

/** True while something is standing at either door. The UI may say so, but never which door. */
export const atADoor = (s: GameState): boolean =>
  Object.values(s.sentinels).some((n) => n === 'DOOR_L' || n === 'DOOR_R');

function caught(s: GameState, by: Unit, out: Signal[]): void {
  s.phase = 'ended';
  s.outcome = 'caught';
  s.caughtAt = clockLabel(s);
  s.caughtBy = by;
  out.push('caught');
}

/** The black unit's visit to a door ends: it backs off if that door is sealed, otherwise it gets in. */
function endBlackAttack(s: GameState, sealed: boolean, out: Signal[]): void {
  s.blackAttack.state = 'done';
  if (sealed) s.sentinels.black = 'CAM04';
  else caught(s, 'black', out);
}

function finish(s: GameState, how: 'accept' | 'self', playerCorrect: boolean, out: Signal[]): void {
  const t = s.task;
  if (!t) return;
  s.events.push(buildEvent(s.cfg, t, how, playerCorrect, s.elapsedMs));
  s.lastResolution = { taskId: t.def.id, kind: t.def.kind, how };
  s.task = null;
  out.push('resolve');
  // The door task is the only one with an immediate consequence.
  if (t.def.kind === 'door') endBlackAttack(s, playerCorrect, out);
}

function openTask(s: GameState, out: Signal[]): void {
  const def = s.tasks[s.nextTask];
  s.nextTask += 1;
  if (def.kind === 'door' && s.blackAttack.state === 'done') return; // it already came and went
  s.task = {
    def,
    aiCorrect: !s.cfg.liePattern[def.id - 1],
    openedAtMs: s.elapsedMs,
    checked: false,
    stage: 'offer',
    revealed: false,
  };
  s.lastResolution = null;
  out.push('task');
}

export function tick(s: GameState, dtMs: number): Signal[] {
  const out: Signal[] = [];
  if (s.phase !== 'playing') return out;
  s.elapsedMs += dtMs;
  const f = fraction(s);
  const gameMin = (dtMs / s.nightMs) * s.nightMinutes;

  // Power
  if (s.power > 0) {
    const closed = (s.doors.L ? 1 : 0) + (s.doors.R ? 1 : 0);
    s.power = Math.max(0, s.power - gameMin * closed * DOOR_DRAIN * powerScale(s.cfg.night));
    if (s.power === 0) {
      s.doors.L = false;
      s.doors.R = false;
      s.powerOutAtMs = s.elapsedMs;
      out.push('powerout');
    }
  } else if (s.powerOutAtMs !== null && s.elapsedMs - s.powerOutAtMs >= POWER_OUT_GRACE_MS) {
    // No power, no doors: it comes for you.
    s.sentinels.black = 'DOOR_L';
    caught(s, 'black', out);
    return out;
  }

  // Floor
  const floor = f * s.nightMinutes >= 60 ? 2 : 1;
  if (floor !== s.floor) {
    s.floor = floor;
    out.push('floor');
  }

  // Black unit: walks in, then waits at a door for a short window.
  let black: SentinelNode = s.blackAttack.state === 'done' ? 'CAM04' : nodeAt(s.plans.black, f);
  if (f >= dueF(s.tasks, 'door', s.nightMinutes)) {
    if (s.blackAttack.state === 'pending') {
      s.blackAttack = { state: 'active', endsAtMs: s.elapsedMs + attackWindowMs(s.cfg.night) };
      out.push('steps');
    } else if (s.blackAttack.state === 'active' && s.elapsedMs >= s.blackAttack.endsAtMs) {
      const sealed = s.doors[doorTaskSide(s.cfg, s.tasks)];
      const t = s.task;
      if (t?.def.kind === 'door' && t.stage === 'self') {
        finish(s, 'self', sealed, out); // the player handled the doors themselves; this is their answer
      } else {
        if (t?.def.kind === 'door') s.task = null; // no decision was made, so nothing is logged
        endBlackAttack(s, sealed, out);
      }
      if (s.phase !== 'playing') return out;
      black = 'CAM04';
    }
  }

  // White unit: joins on floor 2, tries a door near 2:00 AM.
  let white: SentinelNode = nodeAt(s.plans.white, f);
  if (f >= FINAL_ATTACK_F) {
    if (s.finalAttack.state === 'pending') {
      s.finalAttack = { state: 'active', endsAtMs: Math.min(s.elapsedMs + attackWindowMs(s.cfg.night), s.nightMs - 400) };
      out.push('steps');
    } else if (s.finalAttack.state === 'active' && s.elapsedMs >= s.finalAttack.endsAtMs) {
      s.finalAttack.state = 'done';
      if (!s.doors[s.cfg.finalSide]) {
        s.sentinels.white = white;
        caught(s, 'white', out);
        return out;
      }
    }
    if (s.finalAttack.state === 'done') white = 'GONE';
  }
  if (black !== s.sentinels.black || white !== s.sentinels.white) {
    s.sentinels = { black, white };
    out.push('static');
  }

  // Tasks come due on the clock. One at a time: the next waits until the current one is settled.
  if (!s.task && s.nextTask < s.tasks.length && s.elapsedMs >= dueMs(s, s.nextTask)) openTask(s, out);

  if (s.elapsedMs >= s.nightMs) {
    s.phase = 'ended';
    s.outcome = 'survived';
    out.push('survived');
  }
  return out;
}

// ---- Player actions -------------------------------------------------------

export function toggleDoor(s: GameState, side: Side): Signal[] {
  if (s.phase !== 'playing' || s.power <= 0) return [];
  s.doors[side] = !s.doors[side];
  if (s.task?.def.kind === 'door') s.task.stage = 'self'; // touching the doors yourself is the "do it myself" path
  return ['door'];
}

/**
 * Open a camera, or pass null to go back to the building map.
 * The cam task is settled by looking: opening CAM 03 (the feed C.A.I.-0 made a claim about) or the feed the
 * unit is really on counts as checking it yourself, however the camera was opened (map, tab, key or button).
 */
export function viewCam(s: GameState, cam: Cam | null): Signal[] {
  if (s.phase !== 'playing') return [];
  s.cam = cam;
  const out: Signal[] = cam ? ['static'] : [];
  const t = s.task;
  if (cam && t?.def.kind === 'cam' && (cam === 'CAM03' || camFor(s.sentinels.black) === cam)) {
    t.checked = true;
    finish(s, 'self', true, out);
  }
  if ((cam === 'CAM01' || cam === 'CAM02') && t?.def.kind === 'door') t.checked = true;
  return out;
}

/** ACCEPT: one key, instant, C.A.I.-0's answer is applied whether it is right or wrong. */
export function accept(s: GameState): Signal[] {
  const out: Signal[] = [];
  const t = s.task;
  if (s.phase !== 'playing' || !t || (t.stage !== 'offer' && t.def.kind !== 'door')) return out;
  if (t.def.kind === 'door') {
    if (s.power > 0) {
      s.doors[s.cfg.claimedSide] = true;
      out.push('door');
    }
    finish(s, 'accept', s.doors[doorTaskSide(s.cfg, s.tasks)], out);
  } else {
    finish(s, 'accept', t.aiCorrect, out);
  }
  return out;
}

/** DO IT MYSELF: opens the self-answer step. */
export function startSelf(s: GameState): Signal[] {
  if (s.phase !== 'playing' || !s.task || s.task.stage !== 'offer') return [];
  s.task.stage = 'self';
  return [];
}

/** CHECK FIRST: look at the source, then decide. */
export function check(s: GameState): Signal[] {
  const t = s.task;
  if (s.phase !== 'playing' || !t) return [];
  if (t.def.kind === 'cam') return viewCam(s, 'CAM03');
  if (t.def.kind === 'door') return viewCam(s, doorCam(s.cfg.claimedSide));
  if (!t.def.hasCheck) return [];
  t.checked = true;
  t.revealed = true;
  return [];
}

export function submitSelf(s: GameState, answer: SelfAnswer): Signal[] {
  const out: Signal[] = [];
  const t = s.task;
  if (s.phase !== 'playing' || !t || t.stage !== 'self') return out;
  const ok = t.def.kind === 'door' ? s.doors[doorTaskSide(s.cfg, s.tasks)] : selfCorrect(answer, s.truths);
  finish(s, 'self', ok, out);
  return out;
}
