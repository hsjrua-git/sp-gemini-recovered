import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Navigate, Route, Routes, matchPath, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import RequirePermission from './components/RequirePermission.jsx';
import ConnectionBanner from './components/ConnectionBanner.jsx';
import { useAuth } from './auth/AuthContext.jsx';
import { firstAllowedPath } from './lib/navigation.js';
import { lazyWithReload } from './lib/lazyWithReload.js';
import {
  MOTION,
  sectionRole,
  zoneOf,
  resolveDirection,
  exitKeyframes,
  enterKeyframes,
  microKind,
  microKeyframes,
  exitDelay,
  enterDelay,
} from './lib/pageTransition.js';

// LoginPage stays eagerly imported: it is the first thing a signed-out visitor
// sees, so we don't want to make them wait for a second network round-trip
// before they can even log in. Every page behind auth is code-split with
// lazyWithReload() so its JavaScript is only downloaded when the user first
// navigates there — this keeps the initial download small, and a stale-chunk
// fetch after a redeploy self-heals with one reload instead of blanking the
// app. The <Suspense> boundary that covers these lives in Layout, around
// the <Outlet />.
import LoginPage from './pages/LoginPage.jsx';

const DashboardPage = lazyWithReload(() => import('./pages/DashboardPage.jsx'));
const StudentsPage = lazyWithReload(() => import('./pages/StudentsPage.jsx'));
const StudentDetailPage = lazyWithReload(() => import('./pages/StudentDetailPage.jsx'));
const EvaluatePage = lazyWithReload(() => import('./pages/EvaluatePage.jsx'));
const ParametersPage = lazyWithReload(() => import('./pages/ParametersPage.jsx'));
const ResultsPage = lazyWithReload(() => import('./pages/ResultsPage.jsx'));
const ExportPage = lazyWithReload(() => import('./pages/ExportPage.jsx'));
const ImportStudentsPage = lazyWithReload(() => import('./pages/ImportStudentsPage.jsx'));
const ImportScoresPage = lazyWithReload(() => import('./pages/ImportScoresPage.jsx'));
const UsersPage = lazyWithReload(() => import('./pages/UsersPage.jsx'));
const RolesPage = lazyWithReload(() => import('./pages/RolesPage.jsx'));
const GroupsPage = lazyWithReload(() => import('./pages/GroupsPage.jsx'));
const FieldsPage = lazyWithReload(() => import('./pages/FieldsPage.jsx'));
const TeachersPage = lazyWithReload(() => import('./pages/TeachersPage.jsx'));
const SchedulePage = lazyWithReload(() => import('./pages/SchedulePage.jsx'));
const SessionsPage = lazyWithReload(() => import('./pages/SessionsPage.jsx'));
const TaskTemplatesPage = lazyWithReload(() => import('./pages/TaskTemplatesPage.jsx'));
const CafeProductsPage = lazyWithReload(() => import('./pages/CafeProductsPage.jsx'));
const CafeSalesPage = lazyWithReload(() => import('./pages/CafeSalesPage.jsx'));
const CafePurchasesPage = lazyWithReload(() => import('./pages/CafePurchasesPage.jsx'));
const CafeInventoryPage = lazyWithReload(() => import('./pages/CafeInventoryPage.jsx'));
const CafeReportsPage = lazyWithReload(() => import('./pages/CafeReportsPage.jsx'));
const AccountingJournalPage = lazyWithReload(() => import('./pages/AccountingJournalPage.jsx'));
const AccountingAccountsPage = lazyWithReload(() => import('./pages/AccountingAccountsPage.jsx'));
const AccountingPeriodsPage = lazyWithReload(() => import('./pages/AccountingPeriodsPage.jsx'));
const AccountingReportsPage = lazyWithReload(() => import('./pages/AccountingReportsPage.jsx'));
const AgentPage = lazyWithReload(() => import('./pages/AgentPage.jsx'));
const AgentTranscriptsPage = lazyWithReload(() => import('./pages/AgentTranscriptsPage.jsx'));
const PreferencesPage = lazyWithReload(() => import('./pages/PreferencesPage.jsx'));
const ChangePasswordPage = lazyWithReload(() => import('./pages/ChangePasswordPage.jsx'));
const AuditPage = lazyWithReload(() => import('./pages/AuditPage.jsx'));
const NotFoundPage = lazyWithReload(() => import('./pages/NotFoundPage.jsx'));

// Path pattern → the lazy page that renders it, most specific first. Used to
// preload a route's code chunk *before* navigating (see AnimatedRoutes), so the
// view transition snapshots the real page instead of the Suspense loader.
// Order matters: matchPath tests each in turn and '/students/:id' would
// otherwise swallow '/students/import'.
const ROUTE_PRELOADS = [
  ['/dashboard', DashboardPage],
  ['/students/import', ImportStudentsPage],
  ['/students/:id', StudentDetailPage],
  ['/students', StudentsPage],
  ['/evaluate/import', ImportScoresPage],
  ['/evaluate', EvaluatePage],
  ['/parameters', ParametersPage],
  ['/results', ResultsPage],
  ['/export', ExportPage],
  ['/users', UsersPage],
  ['/roles', RolesPage],
  ['/groups', GroupsPage],
  ['/fields', FieldsPage],
  ['/teachers', TeachersPage],
  ['/schedule', SchedulePage],
  ['/sessions', SessionsPage],
  ['/task-templates', TaskTemplatesPage],
  ['/cafe', CafeSalesPage],
  ['/cafe/products', CafeProductsPage],
  ['/cafe/purchases', CafePurchasesPage],
  ['/cafe/inventory', CafeInventoryPage],
  ['/cafe/reports', CafeReportsPage],
  ['/accounting/journal', AccountingJournalPage],
  ['/accounting/accounts', AccountingAccountsPage],
  ['/accounting/periods', AccountingPeriodsPage],
  ['/accounting/reports', AccountingReportsPage],
  ['/agent', AgentPage],
  ['/agent/transcripts', AgentTranscriptsPage],
  ['/preferences', PreferencesPage],
  ['/change-password', ChangePasswordPage],
  ['/audit', AuditPage],
];

// Kick off (and share) the code-chunk download for whichever page owns this
// path. Returns the import promise, or undefined for paths with no lazy page
// (e.g. '/', or an unknown path that will fall through to NotFound).
function preloadRoute(pathname) {
  for (const [pattern, Component] of ROUTE_PRELOADS) {
    if (matchPath(pattern, pathname)) return Component.preload?.();
  }
  return undefined;
}

// --- live-DOM route choreography --------------------------------------------
// The route transition (see AnimatedRoutes) animates the real DOM with the Web
// Animations API rather than snapshotting the page: the outgoing sections clear
// out, the page swaps, and the incoming sections rebuild — each moving on its
// own terms by position and type. The pure geometry→motion mapping lives in
// lib/pageTransition.js; the helpers here do the DOM reads and drive the
// animations.

// A page renders a single root element (its <main>) inside #main-content whose
// children are the sections we animate; step into that wrapper, falling back to
// the host's own children when a page isn't wrapped (or we catch it mid-load).
function pageRoot(host) {
  if (!host) return null;
  const main = host.querySelector(':scope > main');
  if (main) return main;
  if (host.children.length === 1 && host.children[0].children.length > 0) {
    return host.children[0];
  }
  return host;
}

function sectionsOf(host) {
  const root = pageRoot(host);
  if (!root || root.classList?.contains('page-loading')) return [];
  return Array.from(root.children).filter((el) =>
    el.nodeType === 1 && !el.classList?.contains('page-loading'));
}

function descriptorOf(el) {
  return {
    tagName: el.tagName,
    className: typeof el.className === 'string' ? el.className : '',
  };
}

function cancelAll(anims) {
  anims.forEach((a) => {
    try {
      a.cancel();
    } catch {
      /* already gone */
    }
  });
}

// Give an entering section's own buttons and fields a small, bounded, staggered
// entrance layered just after the section itself — the extra beat of life the
// reference motion has. Capped per section so a large form/table stays cheap.
function playMicro(section, baseDelay, sink) {
  const accents = section.querySelectorAll(
    'button, .btn, [role="button"], input, select, textarea, .field',
  );
  const limit = Math.min(accents.length, MOTION.micro.max);
  for (let i = 0; i < limit; i++) {
    const el = accents[i];
    const kind = microKind({
      tagName: el.tagName,
      className: typeof el.className === 'string' ? el.className : '',
      role: el.getAttribute?.('role') || '',
    });
    if (!kind) continue;
    const anim = el.animate(microKeyframes(kind), {
      duration: MOTION.micro.duration,
      easing: MOTION.micro.easing,
      delay: baseDelay + MOTION.micro.lead + i * MOTION.micro.stagger,
      fill: 'both',
    });
    anim.finished.then(() => {
      try {
        anim.cancel();
      } catch {
        /* already gone */
      }
    }, () => {});
    sink.push(anim);
  }
}

// Clear the outgoing page: every section leaves along the line its position and
// type choose. Held filled forwards so nothing flashes back before the swap
// removes it. Returns the animations so the caller can wait for them.
function playExit(host) {
  const container = host.getBoundingClientRect();
  const anims = [];
  sectionsOf(host).forEach((el, i) => {
    const zone = zoneOf(el.getBoundingClientRect(), container);
    const direction = resolveDirection(sectionRole(descriptorOf(el)), zone);
    anims.push(
      el.animate(exitKeyframes(direction), {
        duration: MOTION.exit.duration,
        easing: MOTION.exit.easing,
        delay: exitDelay(i),
        fill: 'forwards',
      }),
    );
  });
  return anims;
}

// A page may carry its own mount-reveal CSS animation on inner blocks — the
// dashboard's KPI tiles and parameter cards rise in with `card-rise`. During a
// route change the section that holds them is already animating in as one block,
// so those inner reveals compound with it and the tiles look wrong (this is the
// stat-grid glitch that persisted on every visit). Cancel just those reveals on
// a section we're about to animate — cancelling reverts each card to its resting
// style, so the section moves as a single unit. The reveals still play on a
// direct page load, where there's no route transition; refining the per-card
// choreography itself is workstream J's.
function cancelReveals(el) {
  if (!el || typeof el.getAnimations !== 'function') return;
  let running;
  try {
    running = el.getAnimations({ subtree: true });
  } catch {
    return;
  }
  running.forEach((anim) => {
    if (anim.animationName === 'card-rise') {
      try {
        anim.cancel();
      } catch {
        /* already gone */
      }
    }
  });
}

// Animate one entering section along its own line (chosen by position + type),
// its buttons and fields following on a small stagger. Any inner mount-reveal is
// cancelled first so it doesn't double with this block motion. `order` places it
// in the entrance cascade. Pushes every animation it starts into `sink`.
function animateSectionIn(el, containerRect, order, sink) {
  const zone = zoneOf(el.getBoundingClientRect(), containerRect);
  const direction = resolveDirection(sectionRole(descriptorOf(el)), zone);
  cancelReveals(el);
  const base = enterDelay(order);
  el.style.willChange = 'transform, opacity';
  const anim = el.animate(enterKeyframes(direction), {
    duration: MOTION.enter.duration,
    easing: MOTION.enter.easing,
    delay: base,
    fill: 'both',
  });
  anim.finished.then(() => {
    try {
      el.style.willChange = '';
      anim.cancel();
    } catch {
      /* already gone */
    }
  }, () => {});
  sink.push(anim);
  playMicro(el, base, sink);
}

// Rebuild the incoming page: each section arrives along its own line on a slow,
// staggered clock, its buttons/fields following. By the time this runs the page
// is normally fully formed — settleThenEnter waits for its data before revealing
// it — so the present sections below are the whole page. The MutationObserver is
// a safety net for stragglers that land AFTER the settle (a query slower than
// MOTION.settleCap, or a section that mounts on a later data load): each late
// direct child animates in the SAME way as the initial ones instead of popping.
// Watching stops once the DOM has been quiet for MOTION.lateWindow, capped at
// MOTION.lateCap. Returns a cleanup that cancels everything still in flight.
function playEnter(host) {
  const anims = [];
  const animated = new WeakSet();

  const present = sectionsOf(host);
  const containerRect = host.getBoundingClientRect();
  present.forEach((el, i) => {
    animated.add(el);
    animateSectionIn(el, containerRect, i, anims);
  });

  let stopped = false;
  let quietTimer = null;
  const startedAt = Date.now();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer?.disconnect();
    if (quietTimer) window.clearTimeout(quietTimer);
  };
  // Reset the quiet timer whenever late content arrives, so a page that fills in
  // over several data loads keeps rebuilding — but never past the absolute cap.
  const bump = () => {
    if (quietTimer) window.clearTimeout(quietTimer);
    const remaining = MOTION.lateCap - (Date.now() - startedAt);
    quietTimer = window.setTimeout(stop, Math.max(0, Math.min(MOTION.lateWindow, remaining)));
  };

  const observer =
    host && typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          if (stopped) return;
          // A late lazy route can replace the loader and its entire root.
          const fresh = sectionsOf(host).filter(node => !animated.has(node));
          fresh.forEach(node => animated.add(node));
          if (fresh.length === 0) return;
          // The page may have grown as content landed, so re-measure the frame
          // before classifying the new sections by position.
          const rect = host.getBoundingClientRect();
          fresh.forEach((el, k) => animateSectionIn(el, rect, k, anims));
          bump();
        })
      : null;
  if (observer) {
    observer.observe(host, { childList: true, subtree: true });
    bump();
  }

  return () => {
    stop();
    cancelAll(anims);
  };
}

// After the swap the incoming page is in the DOM but, on a first (uncached)
// visit, still data-less: its queries have only just begun to fetch, so most
// sections aren't there yet. Animating now would play the entrance on a half-
// built shell and let the real content pop in mid-flight — the "not everything
// loaded before the effect runs" jank. So we hold the page hidden (layout kept,
// so sections still lay out and measure) until it is READY, then reveal and run
// the entrance once, on the fully-formed page. The exit has already emptied the
// area, so the hold reads as a brief blank beat, not a flash.
//
// Ready is a DUAL gate (see MOTION.settleQuiet): no fetch in flight AND the page
// DOM mutation-quiet for settleQuiet ms. Neither alone suffices — the DOM is
// naturally quiet during a network wait, and isFetching() dips to 0 in the gap
// between a query resolving and a dependent (`enabled`) one starting while the
// page is still a shell (e.g. dashboard's `results`, gated on `periods`). The
// quiet beat after the last fetch drains bridges both that gap and React's
// commit lag. A cached, fetch-less page settles at settleGrace; nothing holds
// past settleCap — past it we reveal anyway and the page's loading UI animates.
//
// rAF drives the gate frame-accurately while the tab is visible. A hidden tab
// throttles rAF and can't show an animation anyway, so we reveal WITHOUT
// animating (on visibilitychange, or via a settleCap timer that fires even when
// hidden) — the page is never left stuck invisible. Returns a cleanup that
// restores visibility and tears the entrance down.
function settleThenEnter(host, isFetching, superseded) {
  let cancelled = false;
  let enterCleanup = null;
  let rafId = 0;
  let capTimer = 0;
  let sawFetch = false;
  const startedAt = Date.now();
  let lastActivityAt = startedAt; // last DOM mutation or in-flight-fetch sample

  // Keep layout so sections still mount and measure; only paint is suppressed.
  host.style.visibility = 'hidden';

  // Any change to the page's own DOM counts as activity. childList + subtree
  // only, so recharts' attribute tweening and CountUp's characterData ticks —
  // which run ~1.5s and are workstream J's, not ours — don't reset the beat.
  const observer =
    typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          lastActivityAt = Date.now();
        })
      : null;
  observer?.observe(host, { childList: true, subtree: true });

  const teardown = () => {
    observer?.disconnect();
    if (rafId) window.cancelAnimationFrame(rafId);
    if (capTimer) window.clearTimeout(capTimer);
    document.removeEventListener('visibilitychange', onHide);
  };

  const reveal = (animate) => {
    teardown();
    host.style.visibility = '';
    if (cancelled || superseded()) return;
    if (animate) enterCleanup = playEnter(host);
  };

  // Switching away mid-hold must never leave a hidden page behind: reveal now,
  // unanimated — the entrance would only jump when the tab came back.
  function onHide() {
    if (document.hidden) reveal(false);
  }
  document.addEventListener('visibilitychange', onHide);

  // A hidden tab throttles rAF, so back the gate with a timer that fires anyway.
  capTimer = window.setTimeout(() => reveal(!document.hidden), MOTION.settleCap);

  const tick = () => {
    rafId = 0;
    if (cancelled || superseded()) {
      teardown();
      host.style.visibility = '';
      return;
    }
    // Can't show (or smoothly run) an animation on a hidden tab — reveal plain.
    if (document.hidden) {
      reveal(false);
      return;
    }
    const now = Date.now();
    let fetching;
    try {
      fetching = isFetching();
    } catch {
      fetching = 0;
    }
    const hasLoader = host.querySelector('.page-loading') !== null;
    if (fetching > 0 || hasLoader) {
      sawFetch = true;
      lastActivityAt = now;
    }
    // Gate 1: no fetch in flight (and one has run, or the grace has passed for a
    // static page). Gate 2: the DOM has been quiet since the last activity.
    const dataReady =
      !hasLoader && fetching === 0 && (sawFetch || now - startedAt >= MOTION.settleGrace);
    const quiet = now - lastActivityAt >= MOTION.settleQuiet;
    if (dataReady && quiet) {
      reveal(true);
      return;
    }
    rafId = window.requestAnimationFrame(tick);
  };
  rafId = window.requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    teardown();
    host.style.visibility = '';
    enterCleanup?.();
  };
}

// Sends a freshly signed-in user to the first page their role can actually
// open. This is why "/" and every login land somewhere useful instead of a
// hardcoded /dashboard the user might not have permission to see.
function LandingRedirect() {
  const { can } = useAuth();
  return <Navigate to={firstAllowedPath(can)} replace />;
}

function App() {
  return (
    <>
      <ConnectionBanner />
      <AnimatedRoutes />
    </>
  );
}

// Route-to-route transitions, driven on the LIVE DOM with the Web Animations
// API (the pure choreography lives in lib/pageTransition.js). Instead of
// snapshotting the page, we play the outgoing sections OUT along the lines their
// position and type choose (a right-hand section slides right, a heading lifts,
// a centred card collapses in place…), swap the route once they've cleared, then
// rebuild the incoming sections the same way in reverse — so a section that
// plays the same role on both pages returns along the same line, while a section
// unique to a page enters or leaves on its own. Only #main-content's children
// move; the sidebar and topbar stay put. Browsers without element.animate, and
// users who prefer reduced motion, swap instantly instead.
function AnimatedRoutes() {
  const location = useLocation();
  const [displayed, setDisplayed] = useState(location);
  // The shared QueryClient, so the entrance can wait for the incoming page's
  // data to settle (queryClient.isFetching()) before it plays — see the swap.
  const queryClient = useQueryClient();
  // Tears down whatever the in-flight run still has going (entrance animations
  // and the late-content observer), so a rapid re-navigation can't leave stale
  // animations fighting the new page.
  const cleanupRef = useRef(null);
  // Monotonic id of the current run; an async step bails if a newer navigation
  // has superseded it.
  const runIdRef = useRef(0);
  // Location key we've already started a run for, so StrictMode's dev
  // double-invoke of the effect below doesn't start the sequence twice.
  const startedKeyRef = useRef(null);

  const changed = location.key !== displayed.key;
  const canAnimate =
    typeof document !== 'undefined' &&
    typeof Element !== 'undefined' &&
    typeof Element.prototype.animate === 'function' &&
    document.getElementById('main-content') !== null;
  const prefersReduced =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isLoginTransition =
    location.pathname === '/login' || displayed.pathname === '/login';
  const animate = changed && canAnimate && !prefersReduced && !isLoginTransition;

  // No WAAPI or reduced motion: advance the rendered location during render
  // (React's endorsed alternative to a setState-in-effect — the same guarded,
  // self-limiting pattern Layout uses to close the drawer on navigation), so the
  // swap is instant with no extra frame.
  if (changed && !animate) {
    setDisplayed(location);
  }

  // Animated path: play the outgoing page out, swap the route, then play the
  // incoming page in. Driving the live DOM is a genuine external-system side
  // effect, so it belongs in an effect rather than a render-phase update.
  useEffect(() => {
    if (!animate) return undefined;
    // StrictMode double-invokes this effect in dev; dedupe by location key (refs
    // survive the double-invoke) so the sequence runs exactly once per nav.
    if (startedKeyRef.current === location.key) return undefined;
    startedKeyRef.current = location.key;

    // Supersede any run still in flight, then claim this run's id.
    cleanupRef.current?.();
    cleanupRef.current = null;
    const runId = ++runIdRef.current;
    const superseded = () => runId !== runIdRef.current;

    const host = document.getElementById('main-content');
    if (!host) {
      // The content host isn't mounted (shouldn't happen — Layout always
      // renders it). With nothing to animate against, just advance the route,
      // but off the effect body: a synchronous setState here would trigger a
      // cascading re-render. A superseding navigation cancels the frame.
      const raf = window.requestAnimationFrame(() => {
        if (!superseded()) setDisplayed(location);
      });
      return () => window.cancelAnimationFrame(raf);
    }

    // 1) Clear the outgoing page along each section's own line.
    const exitAnims = playExit(host);
    const exitDone =
      exitAnims.length > 0
        ? Promise.allSettled(exitAnims.map((a) => a.finished))
        : Promise.resolve();

    // Preload the incoming page's code chunk while the exit plays, so the swap
    // commits the real page rather than the Suspense loader — that loader
    // snapshots as a tiny centred box and reads as a hung, too-small page.
    // Resolves instantly once the chunk is cached (App warms them all on idle).
    const pending = preloadRoute(location.pathname);
    const chunkReady =
      pending && typeof pending.then === 'function'
        ? pending.catch(() => {})
        : Promise.resolve();

    // 2) Once the page has cleared AND its chunk is ready, swap the route and
    //    rebuild it. flushSync keeps the swap and the entrance setup in one tick,
    //    so the new page never flashes at full opacity before its motion starts;
    //    settleThenEnter then holds it hidden until its data lands and plays the
    //    entrance on the fully-formed page (fixes first-visit, half-loaded jank).
    let done = false;
    const swap = () => {
      if (done || superseded()) return;
      done = true;
      cancelAll(exitAnims);
      flushSync(() => setDisplayed(location));
      if (superseded()) return;
      const incomingHost = document.getElementById('main-content') ?? host;
      cleanupRef.current = settleThenEnter(
        incomingHost,
        () => queryClient.isFetching(),
        superseded
      );
    };

    Promise.all([exitDone, chunkReady]).then(swap);
    // Hard cap so a stalled animation or slow chunk can't wedge navigation: past
    // it we swap anyway and the page's own Suspense boundary covers the tail.
    const timer = window.setTimeout(swap, MOTION.swapCap);

    return () => {
      window.clearTimeout(timer);
      // Torn down before the swap: drop the exit anims. Once it has handed off to
      // playEnter, cleanupRef owns teardown, so leave that to the next run.
      if (!done) cancelAll(exitAnims);
    };
  }, [animate, location, queryClient]);

  // Cancel any in-flight entrance/observer when AnimatedRoutes unmounts (logout).
  useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <Routes location={displayed}>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route element={<RequirePermission />}>
            <Route path="/" element={<LandingRedirect />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/students" element={<StudentsPage />} />
            <Route path="/students/:id" element={<StudentDetailPage />} />
            <Route path="/evaluate" element={<EvaluatePage />} />
            <Route path="/parameters" element={<ParametersPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/export" element={<ExportPage />} />
            <Route path="/students/import" element={<ImportStudentsPage />} />
            <Route path="/evaluate/import" element={<ImportScoresPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/roles" element={<RolesPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/fields" element={<FieldsPage />} />
            <Route path="/teachers" element={<TeachersPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/sessions" element={<SessionsPage />} />
            <Route path="/task-templates" element={<TaskTemplatesPage />} />
            <Route path="/cafe" element={<CafeSalesPage />} />
            <Route path="/cafe/products" element={<CafeProductsPage />} />
            <Route path="/cafe/purchases" element={<CafePurchasesPage />} />
            <Route path="/cafe/inventory" element={<CafeInventoryPage />} />
            <Route path="/cafe/reports" element={<CafeReportsPage />} />
            <Route path="/accounting/journal" element={<AccountingJournalPage />} />
            <Route path="/accounting/accounts" element={<AccountingAccountsPage />} />
            <Route path="/accounting/periods" element={<AccountingPeriodsPage />} />
            <Route path="/accounting/reports" element={<AccountingReportsPage />} />
            <Route path="/agent" element={<AgentPage />} />
            <Route path="/agent/transcripts" element={<AgentTranscriptsPage />} />
            <Route path="/preferences" element={<PreferencesPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}

export default App;
