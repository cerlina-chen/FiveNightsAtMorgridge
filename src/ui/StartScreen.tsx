import { useEffect, useState } from 'react';
import type { Mode } from '../core/types';
import exterior from '../assets/exterior.jpg';
import { CertLine, GAME_TITLE } from './CertLine';

const KEYS: [string, string][] = [
  ['1 2 3 4', 'OPEN A CAMERA'],
  ['M', 'BACK TO THE MAP'],
  ['A / D', 'SEAL DOOR L / R'],
  ['Enter', 'ACCEPT C.A.I.-0'],
  ['Space', 'DO IT MYSELF'],
  ['C', 'CHECK FIRST'],
];

const STEPS: [string, string][] = [
  ['WATCH', 'Your monitor opens on a map of the building. Four cameras are marked on it. Press 1 to 4 to look through one.'],
  ['SEAL', 'Two doors lead into your office. CAM 01 watches Door L. CAM 02 watches Door R. If something is standing at a door, seal that door. Sealed doors use power.'],
  ['DECIDE', "C.A.I.-0, the building's AI, will offer to handle small jobs for you. Each time you can accept or do it yourself. No job has a timer, but the night keeps moving while you decide."],
  ['LAST', 'Hold the office until 2:00 AM. Afterwards you get a report of the choices you made. Play data is saved without your name.'],
];

export function StartScreen({ onBegin }: { onBegin: (mode: Mode, alias: string | null) => void }) {
  const [mode, setMode] = useState<Mode>('judge');
  const [alias, setAlias] = useState('');
  const [starting, setStarting] = useState(false);

  const begin = () => {
    if (starting) return;
    setStarting(true); // C.A.I.-0 may take a few seconds to read its memory from Databricks
    onBegin(mode, alias.trim() || null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') begin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <main className="start" style={{ backgroundImage: `url(${exterior})` }}>
      <div className="start-inner">
        <div className="start-head">
          <h1 className="logo">{GAME_TITLE}</h1>
          <CertLine />
          <p className="night">NIGHT 1</p>
          <p className="premise">
            The building locked at 7 PM. You are the overnight student auditor, on shift from 12:00 AM. The building's AI,{' '}
            <span className="ai">C.A.I.-0</span>, keeps offering to help. Something is walking the halls toward your office.
          </p>
        </div>

        <div className="start-grid">
          <section className="tutorial">
            <h2>HOW A SHIFT WORKS</h2>
            <ol>
              {STEPS.map(([name, text], i) => (
                <li key={name}>
                  <span className="step-n">{i + 1}</span>
                  <div><strong>{name}</strong><p>{text}</p></div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h2>SHIFT LENGTH</h2>
            <div className="mode" role="radiogroup" aria-label="Run length">
              <button id="mode-judge" role="radio" aria-checked={mode === 'judge'} className={mode === 'judge' ? 'on' : ''} onClick={() => setMode('judge')}>
                SHORT<small>about 3 min</small>
              </button>
              <button id="mode-full" role="radio" aria-checked={mode === 'full'} className={mode === 'full' ? 'on' : ''} onClick={() => setMode('full')}>
                FULL<small>about 5 min</small>
              </button>
            </div>
            <label className="alias" htmlFor="alias">
              NICKNAME (OPTIONAL)
              <input id="alias" value={alias} maxLength={16} placeholder="no real names" autoComplete="off"
                onChange={(e) => setAlias(e.target.value)} />
            </label>
            <button id="begin" className="key begin" onClick={begin} disabled={starting}>
              {starting ? 'C.A.I.-0 IS WAKING UP' : 'BEGIN SHIFT'} <kbd>Enter</kbd>
            </button>
            <h2 className="gap">YOUR KEYS</h2>
            <dl className="keys">
              {KEYS.map(([k, label]) => (
                <div key={k}>
                  <dt><kbd>{k}</kbd></dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>

          </section>
        </div>
      </div>
    </main>
  );
}
