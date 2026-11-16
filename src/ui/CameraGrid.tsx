import type { Cam, Side, Unit } from '../core/types';
import cam01 from '../assets/cam01.jpg';
import cam02 from '../assets/cam02.jpg';
import cam03 from '../assets/cam03.jpg';
import cam04 from '../assets/cam04.jpg';
import { MorgridgeMap } from './MorgridgeMap';

type Spot = { left: number; bottom: number; height: number };

export const CAMS: { id: Cam; key: string; label: string; place: string; src: string; spot: Spot }[] = [
  { id: 'CAM01', key: '1', label: 'CAM 01', place: 'DOOR L, WEST HALL', src: cam01, spot: { left: 46, bottom: 5, height: 64 } },
  { id: 'CAM02', key: '2', label: 'CAM 02', place: 'DOOR R, EAST HALL', src: cam02, spot: { left: 20, bottom: 5, height: 66 } },
  { id: 'CAM03', key: '3', label: 'CAM 03', place: 'HELLO WORLD HALL', src: cam03, spot: { left: 53, bottom: 30, height: 31 } },
  { id: 'CAM04', key: '4', label: 'CAM 04', place: 'ATRIUM STAIR', src: cam04, spot: { left: 44, bottom: 14, height: 17 } },
];

/** Original placeholder figures. The eyes are the only colour on a feed. */
function Figure({ unit, spot, shift }: { unit: Unit; spot: Spot; shift: number }) {
  const style = { left: `${spot.left + shift}%`, bottom: `${spot.bottom}%`, height: `${spot.height}%` };
  return (
    <svg className={`figure ${unit}`} style={style} viewBox="0 0 60 120" aria-label={`${unit} unit on camera`}>
      <path className="body" d="M30 4c11 0 18 8 18 19 0 8-4 14-9 17l10 8c4 3 5 8 5 14v58H6V62c0-6 1-11 5-14l10-8c-5-3-9-9-9-17C12 12 19 4 30 4z" />
      {unit === 'white' && <rect className="visor" x="16" y="16" width="28" height="14" rx="6" />}
      <circle className="eye" cx="23" cy="23" r="2.8" />
      <circle className="eye" cx="37" cy="23" r="2.8" />
    </svg>
  );
}

interface Props {
  cam: Cam | null;
  units: Unit[];
  doors: Record<Side, boolean>;
  clock: string;
  glitch: boolean;
  onSelect: (cam: Cam | null) => void;
}

export function CameraGrid({ cam, units, doors, clock, glitch, onSelect }: Props) {
  const active = CAMS.find((c) => c.id === cam);
  return (
    <section className="monitor" aria-label="Security monitor">
      <div className={`screen ${glitch ? 'glitch' : ''}`}>
        {active ? (
          <>
            <img className="feed" src={active.src} alt={`${active.label}: ${active.place}`} />
            {units.map((u, i) => <Figure key={u} unit={u} spot={active.spot} shift={i * Math.max(6, active.spot.height / 4)} />)}
            <span className="rec"><i />REC</span>
            <span className="feed-name">{active.label}<br />{active.place}</span>
            <span className="feed-stamp">NIGHT 1<br />{clock}</span>
          </>
        ) : (
          <MorgridgeMap cam={cam} doors={doors} onSelect={onSelect} />
        )}
        <div className="noise" aria-hidden="true" />
      </div>
      <div className="cam-tabs">
        <button id="cam-map" className={`key ${cam === null ? 'on' : ''}`} aria-pressed={cam === null} onClick={() => onSelect(null)}>
          MAP <kbd>M</kbd>
        </button>
        {CAMS.map((c) => (
          <button key={c.id} id={`cam-${c.id}`} className={`key ${cam === c.id ? 'on' : ''}`} aria-pressed={cam === c.id}
            onClick={() => onSelect(c.id)}>
            {c.label} <kbd>{c.key}</kbd>
          </button>
        ))}
      </div>
    </section>
  );
}
