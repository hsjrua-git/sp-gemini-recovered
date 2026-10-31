import { useTranslation } from 'react-i18next';
import CountUp from './CountUp.jsx';

// A student dot's hover label — honest about what "measured" means for that dot.
function dotTitle(t, student) {
  if (student.state === 'full') {
    return t('cohort.stateFull', { name: student.fullName });
  }
  if (student.state === 'partial') {
    return t('cohort.statePartial', {
      name: student.fullName,
      measured: student.measured,
      inUse: student.inUse,
    });
  }
  return t('cohort.stateNone', { name: student.fullName });
}

// Lay the class out as an even halo in the band between the centre readout and
// the progress arc. A phyllotaxis (sunflower) spiral — each successive dot turned
// by the golden angle, its radius following √ so the ring fills evenly — packs any
// roster size, from a handful to a hundred, into the annulus without clumping or
// leaving the disc lopsided. Positions are percentages of the core box, so they
// scale with it. Roster order is preserved, so a dot keeps its place across
// renders (and each carries its own student's identity on hover).
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.5°
const R_INNER = 0.52; // fraction of the core radius — just outside the readout
const R_OUTER = 0.86; // just inside the progress arc

function fieldLayout(count) {
  return Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0 : i / (count - 1); // 0→1 across the roster
    const rFrac = Math.sqrt(R_INNER ** 2 + t * (R_OUTER ** 2 - R_INNER ** 2));
    const angle = i * GOLDEN_ANGLE;
    return {
      left: 50 + rFrac * 50 * Math.cos(angle),
      top: 50 + rFrac * 50 * Math.sin(angle),
    };
  });
}

// One parameter, as a satellite on the orbit ring: a mini coverage ring (how
// many of the class carry a score for it this period) echoing the core arc, with
// the parameter's name beneath. The fraction is the at-a-glance "is this one
// scored yet" signal; clicking the satellite opens the detail drawer with the
// full picture (trend, distribution). Coverage is magnitude, so the ring is a
// single brand hue, not an identity colour; the numbers wear ink tokens, never
// the mark colour.
const SAT_R = 16;
const SAT_C = 2 * Math.PI * SAT_R;

function Satellite({ stat, total, index, onSelect, compact }) {
  const { t } = useTranslation(['reports', 'common']);
  const { parameter, answeredCount } = stat;
  const count = answeredCount ?? stat.count;
  const coverage = total > 0 ? count / total : 0;
  const filled = coverage * SAT_C;
  const label = t('cohort.satelliteLabel', {
    name: parameter.name,
    measured: count,
    count: total,
  });

  return (
    <li className="cohort-sat" style={{ '--i': index }}>
      <button
        type="button"
        className={`sat-node${count === 0 ? ' empty' : ''}${compact ? ' compact' : ''}`}
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => onSelect?.({ type: 'parameter', id: parameter.id })}
      >
        <span className="sat-ring" aria-hidden="true">
          <svg viewBox="0 0 40 40">
            <circle className="sat-ring-track" cx="20" cy="20" r={SAT_R} />
            {coverage > 0 && (
              <circle
                className="sat-ring-value"
                cx="20"
                cy="20"
                r={SAT_R}
                style={{ strokeDasharray: `${filled} ${SAT_C}` }}
              />
            )}
          </svg>
          <span className="sat-frac">
            {compact ? index + 1 : <>{count}<span className="sat-frac-total">/{total}</span></>}
          </span>
        </span>
        {!compact && <span className="sat-name">{parameter.name}</span>}
      </button>
    </li>
  );
}

// The dashboard hero: the whole class as one glowing object. A completion-%
// core sits at the centre with a progress arc drawn to the same number; the
// class field — one dot per student, lit by how completely that student is
// measured this period — forms a halo around it; the parameters orbit it as
// satellites on a ring; four quiet readouts below frame it and double as the
// field's legend (their swatches are the dot colours). This is the page's single
// focal point — everything else stays quiet glass on the grey base. The three
// field states reconcile exactly with the KPI totals because cohortField() and
// summarize() classify against the same set of in-use parameters.
function CompletionHub({ summary, field, stats = [], onSelect, compactSatellites = false, legend }) {
  const { t } = useTranslation(['reports', 'common']);
  const pct = summary.completion; // 0–100, or null when nothing is expected
  const hasPct = pct !== null;

  // Progress arc geometry. The ring is one dash the length of the circumference;
  // the visible portion is the completed fraction, drawn from 12 o'clock (the
  // SVG is rotated −90° in CSS) clockwise.
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const filled = hasPct ? (pct / 100) * circumference : 0;

  // A large roster would crowd the halo; shrink the pips past a threshold.
  const dense = field.length > 80;
  const positions = fieldLayout(field.length);

  // Only the parameters actually in use this period orbit the core. Up to six
  // sit on a true ring; beyond that (or on a narrow screen) they fall back to a
  // wrapped row below the core — see the .cohort-orbit.ring rules in index.css.
  const satellites = stats.filter((stat) => stat.parameter.inUse);
  const ring = satellites.length >= 1 && satellites.length <= 6;

  const fieldLabel = t('cohort.who', {
    count: summary.students,
    full: summary.studentsComplete,
    partial: summary.studentsPartial,
    none: summary.studentsNone,
  });

  const kpis = [
    { key: 'students', label: t('cohort.kpiStudents'), value: summary.students, swatch: 'total' },
    { key: 'full', label: t('cohort.kpiFull'), value: summary.studentsComplete, swatch: 'full' },
    { key: 'partial', label: t('cohort.kpiPartial'), value: summary.studentsPartial, swatch: 'partial' },
    { key: 'none', label: t('cohort.kpiNone'), value: summary.studentsNone, swatch: 'none' },
  ];

  return (
    <section className="cohort-hero" aria-label={t('cohort.heroLabel')}>
      <div className={ring ? 'cohort-orbit ring' : 'cohort-orbit'}>
        <div className="cohort-core">
          <svg className="cohort-arc" viewBox="0 0 120 120" aria-hidden="true">
            <circle className="cohort-arc-track" cx="60" cy="60" r={radius} />
            {hasPct && pct > 0 && (
              <circle
                className="cohort-arc-value"
                cx="60"
                cy="60"
                r={radius}
                style={{ strokeDasharray: `${filled} ${circumference}` }}
              />
            )}
          </svg>

          <div
            className={dense ? 'cohort-field dense' : 'cohort-field'}
            role="img"
            aria-label={fieldLabel}
          >
            {field.map((student, i) => (
              <span
                key={student.id}
                className={`field-dot ${student.state}`}
                title={dotTitle(t, student)}
                style={{ left: `${positions[i].left}%`, top: `${positions[i].top}%` }}
              />
            ))}
          </div>

          <button
            type="button"
            className="cohort-readout cohort-readout-btn"
            aria-haspopup="dialog"
            aria-label={
              `${t('cohort.classSummary')} — ${
                hasPct ? t('cohort.measuredPct', { pct }) : t('cohort.nothingYet')
              }${t('cohort.openDetails')}`
            }
            onClick={() => onSelect?.({ type: 'cohort' })}
          >
            <span className="cohort-pct">
              {hasPct ? <CountUp value={pct} suffix="%" /> : '—'}
            </span>
            <span className="cohort-pct-label">{t('cohort.measured')}</span>
          </button>
        </div>

        {satellites.length > 0 && (
          <ul className="cohort-satellites" style={{ '--n': satellites.length }}>
            {satellites.map((stat, i) => (
              <Satellite
                key={stat.parameter.id}
                stat={stat}
                total={summary.students}
                index={i}
                onSelect={onSelect}
                compact={compactSatellites}
              />
            ))}
          </ul>
        )}
      </div>

      {legend}
      <ul className="cohort-kpis">
        {kpis.map((kpi) => (
          <li key={kpi.key} className="cohort-kpi">
            <span className={`kpi-swatch ${kpi.swatch}`} aria-hidden="true" />
            <span className="kpi-value">
              <CountUp value={kpi.value} />
            </span>
            <span className="kpi-label">{kpi.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default CompletionHub;
