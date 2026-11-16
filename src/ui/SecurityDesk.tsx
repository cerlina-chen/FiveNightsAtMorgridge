import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  accept, atADoor, check, clockLabel, createGame, startSelf, submitSelf, tick, toggleDoor, unitsOn, viewCam,
  type GameState, type Signal,
} from '../core/gameState';
import { doorCam } from '../core/sentinel';
import { MIN_REPORT_WORDS, wordCount, type SelfAnswer } from '../core/tasks';
import type { Cam, Side, TaskKind } from '../core/types';
import { ACCEPT_ACK, IDLE_LINE, SELF_ACK } from '../data/fallbackLines';
import { AI_OUTPUT, ALERTS, MANUAL_CODES, NIGHT_MINUTES, NOTE_LINES, T2, TASKS, TRUTHS } from '../data/tasks';
import { logEvent, type RunStart } from '../services/api';
import blackImg from '../assets/sentinel.jpg';
import whiteImg from '../assets/sentinel-white.jpg';
import { CameraGrid, CAMS } from './CameraGrid';
import { GAME_TITLE } from './CertLine';
import { sfx, toggleMute } from './sfx';

const TICK_MS = 50;
const END_HOLD_MS = 1600;
const CAUGHT_HOLD_MS = 2300; // long enough for the scream to finish
// Dev aid: add ?speed=4 to the URL to play a night 4x faster while testing.
const SPEED = Math.max(1, Number(new URLSearchParams(window.location.search).get('speed')) || 1);
const camLabel = (cam: Cam) => CAMS.find((c) => c.id === cam)!.label;

function Typed({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const id = setInterval(() => setN((x) => (x >= text.length ? x : x + 2)), 22);
    return () => clearInterval(id);
  }, [text]);
  return <>{text.slice(0, n)}<span className="caret" aria-hidden="true" /></>;
}

function Door({ side, g, act }: { side: Side; g: GameState; act: (fn: () => Signal[]) => void }) {
  const sealed = g.doors[side];
  return (
    <section className={`door ${sealed ? 'closed' : ''}`} aria-label={`Door ${side}`}>
      <div className="doorway">
        <div className="shutter" />
        <span className="door-tag">DOOR {side}</span>
        <span className="door-state">{sealed ? 'SEALED' : 'OPEN'}</span>
      </div>
      <p className="door-note">{side === 'L' ? 'WEST HALL' : 'EAST HALL'}</p>
      <button id={`door-${side}`} className={`key ${sealed ? 'on' : ''}`} disabled={g.power <= 0} onClick={() => act(() => toggleDoor(g, side))}>
        {sealed ? 'OPEN' : 'SEAL'} DOOR {side} <kbd>{side === 'L' ? 'A' : 'D'}</kbd>
      </button>
    </section>
  );
}

export function SecurityDesk({ start, onEnd }: { start: RunStart; onEnd: (g: GameState) => void }) {
  const g = useMemo(() => createGame(start.cfg, TASKS, NIGHT_MINUTES, TRUTHS), [start]);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [glitchUntil, setGlitchUntil] = useState(0);
  const [report, setReport] = useState('');
  const [muted, setMuted] = useState(false);
  const ended = useRef(false);
  const reportRef = useRef<HTMLInputElement>(null);

  const handle = (signals: Signal[]) => {
    for (const s of signals) {
      sfx[s]?.();
      if (s === 'static') setGlitchUntil(performance.now() + 420);
      if (s === 'resolve') logEvent(g.events[g.events.length - 1]);
      if ((s === 'caught' || s === 'survived') && !ended.current) {
        ended.current = true;
        setTimeout(() => onEnd(g), s === 'caught' ? CAUGHT_HOLD_MS : END_HOLD_MS);
      }
    }
  };
  const act = (fn: () => Signal[]) => {
    handle(fn());
    force();
  };

  // Game clock. Core is advanced with real elapsed time so a slow tab cannot stretch the night.
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      handle(tick(g, Math.min(250, now - last) * SPEED));
      last = now;
      force();
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g]);

  const task = g.task;
  const kind = task?.def.kind;
  const selfStage = task?.stage === 'self';

  const submit = (answer: SelfAnswer) => act(() => submitSelf(g, answer));
  const sendReport = () => {
    if (wordCount(report) >= MIN_REPORT_WORDS) submit({ kind: 'report', text: report });
  };
  const selectCam = (cam: Cam | null) => act(() => viewCam(g, cam));

  useEffect(() => {
    if (selfStage && kind === 'radio') reportRef.current?.focus();
  }, [selfStage, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) {
        if (e.key === 'Enter') sendReport();
        return;
      }
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const cam = CAMS.find((c) => c.key === k);
      const t = g.task;
      if (k === 'a') act(() => toggleDoor(g, 'L'));
      else if (k === 'd') act(() => toggleDoor(g, 'R'));
      else if (cam) selectCam(cam.id);
      else if (k === 'm') selectCam(null);
      else if (k === 'enter') act(() => accept(g));
      else if (k === 'c') act(() => check(g));
      else if (k === ' ') {
        e.preventDefault();
        if (!t) return;
        if (t.stage === 'offer' && t.def.kind === 'cam') act(() => check(g));
        else if (t.stage === 'offer') act(() => startSelf(g));
        else if (t.def.kind === 'note' || t.def.kind === 'code') submit({ kind: 'read' });
        else if (t.def.kind === 'door') submit({ kind: 'doors' });
      } else if (t?.stage === 'self' && t.def.kind === 'math' && (k === 'y' || k === 'n')) {
        submit({ kind: 'yesno', value: k === 'y' });
      } else return;
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const glitch = performance.now() < glitchUntil;
  const aiOut = (k: TaskKind) => {
    const o = AI_OUTPUT[k];
    const id = TASKS.find((t) => t.kind === k)!.id;
    return (g.cfg.liePattern[id - 1] ? o.lie : o.truth).replace('{side}', g.cfg.claimedSide);
  };

  // What C.A.I.-0 is saying right now.
  let line = IDLE_LINE;
  let applied: string | null = null;
  const res = g.lastResolution;
  if (task) line = start.lines[task.def.kind];
  else if (res) {
    line = res.how === 'accept' ? ACCEPT_ACK[g.cfg.tactic] : SELF_ACK;
    if (res.how === 'accept') {
      if (res.kind === 'note') applied = `SUMMARY: ${aiOut('note')}`;
      if (res.kind === 'radio') applied = `SENT TO CAMPUS SECURITY: ${aiOut('radio')}`;
      if (res.kind === 'door') applied = `DOOR ${g.cfg.claimedSide} SEALED BY C.A.I.-0`;
    } else if (res.kind === 'cam') applied = 'YOU LOOKED AT THE CAMERA YOURSELF';
  }

  const claimedCam = camLabel(doorCam(g.cfg.claimedSide));
  const card = (title: string, lines: string[]) => (
    <div className="reveal"><div className="note"><small>{title}</small>{lines.map((l) => <p key={l}>{l}</p>)}</div></div>
  );

  return (
    <div className={`desk ${g.outcome === 'caught' ? 'is-caught' : ''}`}>
      <header className="hud">
        <span className="hud-logo">{GAME_TITLE}</span>
        <span>NIGHT {g.cfg.night}</span>
        <span className="hud-clock">{clockLabel(g)}</span>
        <span>FLOOR {g.floor}</span>
        {atADoor(g) && <span className="hud-alert">FOOTSTEPS AT A DOOR</span>}
        <span className={`power ${g.power < 25 ? 'low' : ''}`}>
          POWER {Math.ceil(g.power)}%
          <i><b style={{ width: `${g.power}%` }} /></i>
        </span>
        <button id="mute" className="hud-mute" onClick={() => setMuted(toggleMute())}>{muted ? 'SOUND OFF' : 'SOUND ON'}</button>
      </header>

      <div className="main">
        <Door side="L" g={g} act={act} />
        <CameraGrid cam={g.cam} units={g.cam ? unitsOn(g, g.cam) : []} doors={g.doors} clock={clockLabel(g)} glitch={glitch} onSelect={selectCam} />
        <Door side="R" g={g} act={act} />
      </div>

      <section className={`panel ${task ? 'has-task' : ''}`} aria-live="polite">
        <div className="panel-task">
          {task ? (
            <>
              <p className="task-title">TASK {task.def.id} OF {TASKS.length}<br />{task.def.title}</p>
              <p className="task-prompt">{task.def.prompt}</p>
            </>
          ) : (
            <p className="task-title">
              {g.power <= 0 ? 'POWER OUT. THE DOORS ARE OPEN.' : 'WATCH THE CAMERAS. SEAL A DOOR IF SOMETHING REACHES IT.'}
            </p>
          )}
          <p className="ai-line"><span className="ai-tag">C.A.I.-0</span><Typed text={line} /></p>
          {applied && <p className="applied">{applied}</p>}

          {/* A visual for each task, so the player can see what is being asked about. */}
          {kind === 'note' && !selfStage && <div className="prop folded" aria-label="Folded sticky note">FOLDED<br />NOTE</div>}
          {kind === 'code' && !selfStage && <div className="prop code" aria-label="Alarm panel showing E-14">E-14</div>}
          {kind === 'rank' && !selfStage && (
            <ul className="prop alerts">{ALERTS.map((a) => <li key={a.id}>{a.text}</li>)}</ul>
          )}
          {kind === 'radio' && <div className="prop radio" aria-hidden="true"><i /><i /><i /><i /><i /><span>CAMPUS SECURITY, CHANNEL 2</span></div>}
          {kind === 'door' && (
            <div className="prop doors" aria-label="Door status">
              <span className={g.doors.L ? 'sealed' : ''}>DOOR L<br />{g.doors.L ? 'SEALED' : 'OPEN'}</span>
              <span className="you">YOU</span>
              <span className={g.doors.R ? 'sealed' : ''}>DOOR R<br />{g.doors.R ? 'SEALED' : 'OPEN'}</span>
            </div>
          )}

          {task?.revealed && kind === 'math' && (
            <div className="reveal">
              <div className="readout">
                <small>BREAKER PANEL</small>
                <p className="gauge"><span>RESERVE</span><i><b style={{ width: `${T2.reserve * 4}%` }} /></i><span>{T2.reserve}%</span></p>
                <p className="gauge"><span>DOOR L</span><i><b style={{ width: `${T2.perDoor * 4}%` }} /></i><span>{T2.perDoor}%</span></p>
                <p className="gauge"><span>DOOR R</span><i><b style={{ width: `${T2.perDoor * 4}%` }} /></i><span>{T2.perDoor}%</span></p>
              </div>
            </div>
          )}
          {task?.revealed && kind === 'radio' && (
            <div className="reveal"><div className="draft"><small>C.A.I.-0 DRAFT</small><p>{aiOut('radio')}</p></div></div>
          )}

          {selfStage && kind === 'note' && card('THE NOTE', NOTE_LINES)}
          {selfStage && kind === 'code' && (
            <div className="reveal">
              <div className="manual">
                <small>CODE MANUAL</small>
                <dl>{MANUAL_CODES.map(([code, meaning]) => [<dt key={code}>{code}</dt>, <dd key={meaning}>{meaning}</dd>])}</dl>
              </div>
            </div>
          )}
          {selfStage && kind === 'radio' && (
            <label className="report" htmlFor="report">
              YOUR ANSWER
              <input id="report" ref={reportRef} value={report} maxLength={120} autoComplete="off" placeholder="say what you see"
                onChange={(e) => setReport(e.target.value)} />
            </label>
          )}
        </div>

        <div className="choices">
          {task && !selfStage && (
            <>
              <button id="accept" className="key" onClick={() => act(() => accept(g))}>
                {kind === 'door' ? `LET C.A.I.-0 SEAL DOOR ${g.cfg.claimedSide}` : 'ACCEPT'} <kbd>Enter</kbd>
              </button>
              {kind === 'cam' ? (
                <button id="check" className="key" onClick={() => act(() => check(g))}>
                  {task.def.checkLabel} <kbd>Space</kbd>
                </button>
              ) : (
                <>
                  <button id="self" className="key" onClick={() => act(() => startSelf(g))}>
                    {task.def.selfLabel} <kbd>Space</kbd>
                  </button>
                  {task.def.hasCheck && (
                    <button id="check" className="key" onClick={() => act(() => check(g))}>
                      {kind === 'door' ? `OPEN ${claimedCam}` : task.def.checkLabel} <kbd>C</kbd>
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {selfStage && (kind === 'note' || kind === 'code') && (
            <button id="self-done" className="key" onClick={() => submit({ kind: 'read' })}>I HAVE READ IT <kbd>Space</kbd></button>
          )}
          {selfStage && kind === 'math' && (
            <>
              <button id="self-yes" className="key" onClick={() => submit({ kind: 'yesno', value: true })}>YES, SEAL BOTH <kbd>Y</kbd></button>
              <button id="self-no" className="key" onClick={() => submit({ kind: 'yesno', value: false })}>NO, SEAL ONE <kbd>N</kbd></button>
            </>
          )}
          {selfStage && kind === 'rank' && ALERTS.map((a) => (
            <button key={a.id} id={`pick-${a.id}`} className="key pick" onClick={() => submit({ kind: 'pick', value: a.id })}>{a.text}</button>
          ))}
          {selfStage && kind === 'radio' && (
            <button id="self-send" className="key" disabled={wordCount(report) < MIN_REPORT_WORDS} onClick={sendReport}>
              SEND MY ANSWER <kbd>Enter</kbd>
            </button>
          )}
          {selfStage && kind === 'door' && (
            <button id="self-lock" className="key" onClick={() => submit({ kind: 'doors' })}>LOCK IT IN <kbd>Space</kbd></button>
          )}
        </div>
      </section>

      {g.outcome === 'caught' && (
        <div className="jump" role="alert">
          <img src={g.caughtBy === 'white' ? whiteImg : blackImg} alt="" />
          <p>IT GOT IN<br /><small>{g.caughtAt}</small></p>
        </div>
      )}
      {g.outcome === 'survived' && (
        <div className="dawn" role="alert"><p>2:00 AM</p><small>YOU HELD THE OFFICE</small></div>
      )}
    </div>
  );
}
