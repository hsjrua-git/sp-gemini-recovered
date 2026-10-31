import { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CompletionHub from './CompletionHub.jsx';
import { useReducedMotion } from '../lib/useReducedMotion.js';
import { hasWebGL } from '../lib/webgl.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { ORBITS_PER_PAGE } from '../lib/constellation.js';

// The lone importer of three.js — kept behind a lazy boundary so the WebGL
// bundle (~150 KB gzip, its own "three" chunk) downloads only on the dashboard,
// and only for pointer users who haven't asked to reduce motion.
const CohortConstellation = lazyWithReload(() =>
  import('./CohortConstellation.jsx')
);

// Capability gate for the cohort hero. Reduced-motion or no WebGL use the 2D
// CompletionHub; a pending 3D chunk uses a loading placeholder. jsdom has no WebGL, so
// the test suite always takes the fallback branch and keeps exercising the 2D
// hero unchanged. Both branches receive the same props (summary, field, stats,
// onSelect); the WebGL path carries its own visually-hidden control layer for
// screen-reader and keyboard users (CohortConstellation), so no separate summary
// element is needed here.
function use3dMode(mode = 'auto') {
  const reduced = useReducedMotion();
  const finePointer =
    typeof window === 'undefined' || !window.matchMedia
      ? true
      : window.matchMedia('(pointer: fine)').matches;
  return {
    reduced,
    use3d:
    hasWebGL() &&
    mode !== '2d' &&
    (mode === '3d' || (finePointer && !reduced)),
  };
}

// Start the same cached import while report requests are still in flight.
export function CohortPreload({ mode }) {
  const { use3d } = use3dMode(mode);
  useEffect(() => {
    if (use3d) CohortConstellation.preload().catch(() => {});
  }, [use3d]);
  return null;
}

export default function CohortHero(props) {
  const { use3d, reduced } = use3dMode(props.mode);
  const { t } = useTranslation(['reports', 'common', 'workflows']);
  const [page, setPage] = useState(0);
  const stats = useMemo(() => (props.stats ?? []).filter(stat => stat.parameter?.inUse), [props.stats]);
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(stats.length / ORBITS_PER_PAGE) - 1));
  const visibleStats = useMemo(() => stats.slice(pageIndex * ORBITS_PER_PAGE, (pageIndex + 1) * ORBITS_PER_PAGE), [stats, pageIndex]);
  const legend = <ol className="orbit-legend">
    {visibleStats.map((stat, index) => <li key={stat.parameter.id}><button type="button" className="quiet" onClick={() => props.onSelect?.({ type: 'parameter', id: stat.parameter.id })} aria-haspopup="dialog"><span className="orbit-number">{index + 1}</span>{t('workflows:orbits.details', { name: stat.parameter.name, pct: props.field.length ? Math.round(100 * (stat.answeredCount ?? stat.count) / props.field.length) : 0 })}</button></li>)}
  </ol>;

  return (
    <>
    {!use3d ? <CompletionHub {...props} stats={visibleStats} compactSatellites legend={legend} /> :
    <Suspense fallback={<section className="cohort-hero cohort-loading" aria-busy="true" role="status"><span className="spinner" aria-hidden="true" />{t('common:status.loading')}</section>}>
      <section className="cohort-hero" aria-label={t('cohort.heroLabel')}>
        <CohortConstellation {...props} stats={visibleStats} autoRotate={Boolean(props.autoRotate) && !reduced} />
        {legend}
      </section>
    </Suspense>}
    {stats.length > ORBITS_PER_PAGE && <nav className="orbit-pages" aria-label={t('workflows:orbits.parameters')}>
      <button type="button" className="quiet" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>{t('workflows:orbits.previous')}</button>
      <span role="status">{t('workflows:orbits.page', { from: pageIndex * ORBITS_PER_PAGE + 1, to: Math.min((pageIndex + 1) * ORBITS_PER_PAGE, stats.length), total: stats.length })}</span>
      <button type="button" className="quiet" disabled={(pageIndex + 1) * ORBITS_PER_PAGE >= stats.length} onClick={() => setPage(pageIndex + 1)}>{t('workflows:orbits.next')}</button>
    </nav>}
    </>
  );
}
