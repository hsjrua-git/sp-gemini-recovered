import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  NAV_ITEMS,
  NAV_PANELS,
  HOME_ITEM,
  ROUTE_PERMISSIONS,
  hasRoutePermission,
  panelForPath,
  extraTitleForPath,
} from '../lib/navigation.js';
import {
  ChevronsLeftIcon,
  LockIcon,
  PreferencesIcon,
  SignOutIcon,
} from './icons.jsx';
import PageLoader from './PageLoader.jsx';

function Layout() {
  const { user, can, logout } = useAuth();
  // Nav chrome labels come from the `nav` namespace (sections/items/titles);
  // shared strings like the app name come from `common`. `nav` is listed
  // first, so bare keys below resolve there.
  const { t } = useTranslation(['nav', 'common']);
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  // Desktop-only: collapse the labelled rail down to a slim icon-only strip.
  // Session-local React state (like openGroups): a layout convenience that
  // resets at logout and never leaks between users on a shared machine.
  // Starts collapsed at every login — Layout unmounts on logout, so this
  // default re-applies each time a user signs in (ref 5's slim-rail default).
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [railTip, setRailTip] = useState(null);
  // The two-level panel menu: null shows the panel list; a panel key swaps
  // the sidebar to that panel's pages. Follows the route automatically (see
  // the render-time adjust below the drawer close), so landing directly on
  // /cafe/purchases opens the Cafe panel — and the back control returns to
  // the panel list. Kept in React state (not browser storage) so it never
  // leaks between users on a shared machine.
  const [openPanel, setOpenPanel] = useState(() => panelForPath(location.pathname)?.key ?? null);
  const sidebarRef = useRef(null);
  const toggleRef = useRef(null);

  // Close the mobile drawer on navigation so it never lingers over the page.
  // React's endorsed alternative to an effect: adjust state during render when
  // a value it derives from (the path) changes, guarded so it runs only once.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setDrawerOpen(false);
    setRailTip(null);
    // The sidebar follows: landing on a page of another panel swaps to it.
    const panel = panelForPath(location.pathname)?.key ?? null;
    if (panel !== openPanel) setOpenPanel(panel);
  }

  // Track whether we're at the width where the sidebar becomes an overlay
  // drawer (matches the max-width: 880px breakpoint in index.css). This drives
  // the keyboard behaviour below: a focus trap and `inert` only make sense
  // while the sidebar is a floating drawer, never when it's the fixed rail.
  useEffect(() => {
    const query = window.matchMedia('(max-width: 880px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // When the drawer opens on mobile, move focus into it and keep focus trapped
  // there until it closes; Escape closes it and returns focus to the toggle.
  // Off-screen (drawer closed on mobile) the sidebar is `inert`, so its links
  // are neither tabbable nor announced — see the aside below.
  useEffect(() => {
    if (!isMobile || !drawerOpen) return undefined;
    const sidebar = sidebarRef.current;
    const toggle = toggleRef.current;
    if (!sidebar) return undefined;

    const focusable = () =>
      [...sidebar.querySelectorAll(
        'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      )].filter((element) => {
        const style = window.getComputedStyle(element);
        return element.tabIndex >= 0 && !element.matches(':disabled') &&
          !element.closest('[inert]') && element.getClientRects().length > 0 &&
          style.visibility !== 'hidden' && style.visibility !== 'collapse';
      });

    const focusFirst = () => (focusable()[0] ?? sidebar).focus();
    focusFirst();

    function containFocus(event) {
      if (!sidebar.contains(event.target)) focusFirst();
    }

    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        document.removeEventListener('focusin', containFocus);
        setDrawerOpen(false);
        toggle?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        sidebar.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!items.includes(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', containFocus);
      if (sidebar.contains(document.activeElement)) toggle?.focus();
    };
  }, [isMobile, drawerOpen, openPanel]);

  const showNav = !user.mustChangePassword;

  // Only render a panel (and its items) the user is actually allowed to see.
  // The permission for each item comes from ROUTE_PERMISSIONS (null = any
  // signed-in user), the same map the route guard uses — so a hidden link is
  // always also a blocked page. Dashboard (HOME_ITEM) renders above the
  // panels as the permanent home link.
  const allowedItem = (item) => {
    const permission = ROUTE_PERMISSIONS[item.to];
    return hasRoutePermission(can, permission);
  };
  const panels = showNav
    ? NAV_PANELS.map((panel) => ({
        ...panel,
        items: panel.items.filter(allowedItem),
      })).filter((panel) => panel.items.length > 0)
    : [];
  const flatItems = showNav ? NAV_ITEMS.filter(allowedItem) : [];
  const showHome = showNav && allowedItem(HOME_ITEM);
  const activePanel = panels.find((panel) => panel.key === openPanel) ?? null;
  // NavLink's isActive is prefix-based, so on /agent/transcripts it would light
  // up BOTH sibling AI pages. Within a panel, highlight only the item the path
  // actually belongs to: the longest item path that is a prefix of it (exact
  // for the page itself, the top-level page for nested routes like /students/:id).
  const longestMatch = (items) =>
    items.reduce(
      (best, item) =>
        (location.pathname === item.to ||
          location.pathname.startsWith(`${item.to}/`)) &&
        (!best || item.to.length > best.length)
          ? item.to
          : best,
      null
    );
  const activeTo = activePanel ? longestMatch(activePanel.items) : null;
  const flatActiveTo = longestMatch(flatItems);

  const titleKey =
    location.pathname === HOME_ITEM.to
      ? `items.${HOME_ITEM.key}`
      : location.pathname === '/'
        ? null
        : (titleKeyForPath(location.pathname, NAV_PANELS) ?? 'notFound.title');
  const currentTitle = titleKey ? t(titleKey) : t('common:appName');

  useEffect(() => {
    const appName = t('common:appName');
    document.title = currentTitle === appName ? appName : `${currentTitle} — ${appName}`;
  }, [currentTitle, t]);

  useEffect(() => {
    let frame = 0;
    const deadline = performance.now() + 2500;
    const navigationFocus = document.activeElement;
    const focusHeading = () => {
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        active !== navigationFocus &&
        active.isConnected
      ) return;
      const host = document.getElementById('main-content');
      const heading = host?.querySelector('h1');
      if (host?.style.visibility !== 'hidden' && heading) {
        const temporaryTabIndex = !heading.hasAttribute('tabindex');
        if (temporaryTabIndex) heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
        if (temporaryTabIndex) {
          heading.addEventListener('blur', () => heading.removeAttribute('tabindex'), {
            once: true,
          });
        }
        return;
      }
      if (performance.now() < deadline) frame = requestAnimationFrame(focusHeading);
    };
    frame = requestAnimationFrame(focusHeading);
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  // The icon-only rail is a desktop affordance; on mobile the sidebar is a
  // full-width overlay drawer, so collapsing never applies there. It also only
  // applies once the nav is showing — on the forced change-password screen
  // (showNav false) the rail stays expanded so the pinned account actions keep
  // their labels and Change password stays reachable.
  const railCollapsed = showNav && !isMobile && navCollapsed;

  function showRailTip(event) {
    if (!railCollapsed) return;
    const target = event.target.closest('[data-rail-tip]');
    const sidebar = sidebarRef.current;
    if (!target || !sidebar) { setRailTip(null); return; }
    const rect = target.getBoundingClientRect();
    const clip = (target.closest('.sidebar-nav') ?? sidebar).getBoundingClientRect();
    if (rect.bottom <= clip.top || rect.top >= clip.bottom) { setRailTip(null); return; }
    const edge = sidebar.getBoundingClientRect();
    const rtl = document.documentElement.dir === 'rtl';
    setRailTip({
      label: target.getAttribute('data-rail-tip'),
      top: Math.max(24, Math.min(window.innerHeight - 24, rect.top + rect.height / 2)),
      side: rtl ? 'right' : 'left',
      edge: rtl ? window.innerWidth - edge.left + 10 : edge.right + 10,
    });
  }

  function hideRailTip(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) setRailTip(null);
  }

  return (
    <div
      className={`app-shell${drawerOpen ? ' drawer-open' : ''}${
        railCollapsed ? ' nav-collapsed' : ''
      }`}
    >
      <a href="#main-content" className="skip-link">
        {t('skipToContent')}
      </a>

      <aside
        className="sidebar"
        id="primary-navigation"
        aria-label={t('aria.primaryNav')}
        ref={sidebarRef}
        tabIndex={-1}
        inert={isMobile && !drawerOpen}
        onPointerOver={showRailTip}
        onPointerOut={hideRailTip}
        onFocus={showRailTip}
        onBlur={hideRailTip}
        onScrollCapture={() => {
          if (sidebarRef.current?.contains(document.activeElement)) {
            showRailTip({ target: document.activeElement });
          } else setRailTip(null);
        }}
        onKeyDown={event => { if (event.key === 'Escape') setRailTip(null); }}
      >
        <div className="sidebar-top">
          {showNav && (
            <button
              type="button"
              className="rail-toggle"
              aria-label={t(
                navCollapsed ? 'aria.expandSidebar' : 'aria.collapseSidebar'
              )}
              aria-pressed={navCollapsed}
              aria-controls="primary-navigation"
              onClick={() => { setRailTip(null); setNavCollapsed((collapsed) => !collapsed); }}
            >
              <ChevronsLeftIcon className="rail-toggle-icon" size={18} />
            </button>
          )}
          <span className="brand-name">{t('common:appName')}</span>
        </div>
        {showNav && (
          <nav className="sidebar-nav">
            {railCollapsed ? (
              /* The slim icon rail stays FLAT (closest to the old rail): one
                 icon per page across every panel, tooltips when collapsed. */
              <ul className="nav-flat">
                {flatItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === HOME_ITEM.to ? undefined : false}
                        className={() =>
                          `nav-link${item.to === flatActiveTo ? ' active' : ''}`
                        }
                        aria-label={item.key ? t(`items.${item.key}`) : undefined}
                        data-rail-tip={item.key ? t(`items.${item.key}`) : undefined}
                      >
                        <span className="nav-icon" aria-hidden="true">
                          {Icon && <Icon size={18} />}
                        </span>
                        <span className="nav-label">{item.key ? t(`items.${item.key}`) : ''}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            ) : activePanel ? (
              /* Panel view: the selected panel's pages, with a back control. */
              <>
                <button
                  type="button"
                  className="panel-back"
                  onClick={() => setOpenPanel(null)}
                >
                  <ChevronsLeftIcon className="panel-back-icon" size={16} />
                  <span>{t('allPanels')}</span>
                </button>
                <p className="panel-title">{t(`panels.${activePanel.key}`)}</p>
                <ul className="nav-flat">
                  {activePanel.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          className={() =>
                            `nav-link${item.to === activeTo ? ' active' : ''}`
                          }
                          title={item.key ? t(`items.${item.key}`) : undefined}
                        >
                          <span className="nav-icon" aria-hidden="true">
                            {Icon && <Icon size={18} />}
                          </span>
                          <span className="nav-label">{item.key ? t(`items.${item.key}`) : ''}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              /* Panel list: the home link plus one button per panel. */
              <ul className="nav-flat">
                {showHome && (
                  <li>
                    <NavLink
                      to={HOME_ITEM.to}
                      end
                      className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                    >
                      <span className="nav-icon" aria-hidden="true">
                        <HOME_ITEM.icon size={18} />
                      </span>
                      <span className="nav-label">{t(`items.${HOME_ITEM.key}`)}</span>
                    </NavLink>
                  </li>
                )}
                {panels.map((panel) => (
                  <li key={panel.key}>
                    <button
                      type="button"
                      className="nav-link panel-link"
                      onClick={() => setOpenPanel(panel.key)}
                      aria-haspopup="true"
                    >
                      <span className="nav-label">{t(`panels.${panel.key}`)}</span>
                      <span className="panel-count" aria-hidden="true">
                        {panel.items.length}
                      </span>
                      <ChevronsLeftIcon className="panel-chevron" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>
        )}

        {/* Account actions remain reachable in both rail modes. */}
        <div className="sidebar-account">
          <div
            className="sidebar-account-id"
            title={railCollapsed ? `${user.fullName} · ${user.role}` : undefined}
          >
            <span className="avatar" aria-hidden="true">
              {initialsOf(user.fullName)}
            </span>
            <span className="sidebar-account-meta">
              <span className="account-name">{user.fullName}</span>
              <span className="account-role">{user.role}</span>
            </span>
          </div>
          <div className="sidebar-account-actions">
            <NavLink
              to="/preferences"
              className="nav-link"
              aria-label={railCollapsed ? t('items.preferences') : undefined}
              data-rail-tip={railCollapsed ? t('items.preferences') : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <PreferencesIcon size={18} />
              </span>
              <span className="nav-label">{t('items.preferences')}</span>
            </NavLink>
            <NavLink
              to="/change-password"
              className="nav-link"
              aria-label={railCollapsed ? t('items.changePassword') : undefined}
              data-rail-tip={railCollapsed ? t('items.changePassword') : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <LockIcon size={18} />
              </span>
              <span className="nav-label">{t('items.changePassword')}</span>
            </NavLink>
            <button
              type="button"
              className="nav-link account-signout"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              aria-label={railCollapsed ? t('account.signout') : undefined}
              data-rail-tip={railCollapsed ? t('account.signout') : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <SignOutIcon size={18} />
              </span>
              <span className="nav-label">
                {logout.isPending
                  ? t('account.signingOut')
                  : t('account.signout')}
              </span>
            </button>
          </div>
        </div>
      </aside>
      {railCollapsed && railTip && (
        <div className="rail-tooltip-popup" aria-hidden="true"
          style={{ top: railTip.top, [railTip.side]: railTip.edge }}>
          {railTip.label}
        </div>
      )}

      {/* Backdrop only matters on small screens, where the sidebar floats over
          the page; tapping it dismisses the drawer. */}
      <button
        type="button"
        className="drawer-backdrop"
        aria-label={t('aria.closeMenu')}
        tabIndex={drawerOpen ? 0 : -1}
        onClick={() => {
          setDrawerOpen(false);
          // Return focus to the toggle rather than losing it on the now-hidden
          // backdrop (mirrors the Escape behaviour).
          toggleRef.current?.focus();
        }}
      />

      <div className="app-main">
        <header className="app-topbar">
          {showNav && (
            <button
              type="button"
              className="nav-toggle"
              ref={toggleRef}
              aria-label={t('aria.toggleMenu')}
              aria-expanded={drawerOpen}
              aria-controls="primary-navigation"
              onClick={() => setDrawerOpen((open) => !open)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M3 5h14M3 10h14M3 15h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
          <span className="topbar-title" key={currentTitle}>
            {currentTitle}
          </span>
        </header>

        {/* The skip-link jumps here; tabIndex=-1 lets this container take focus
            so keyboard users land past the nav. Suspense shows PageLoader while
            a lazily-loaded page chunk (see App.jsx) downloads. */}
        <div id="main-content" tabIndex={-1}>
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

// Up to two initials for the account chip's avatar: first + last word of the
// full name, falling back to the first character (or "?" for an empty name).
function initialsOf(fullName) {
  const parts = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// The topbar title as a nav-namespace translation KEY (not display text):
// `items.<key>` for sidebar routes, `titles.<key>` for the EXTRA_TITLES/
// dynamic routes, falling back to the nearest top-level item so the header
// still reads sensibly on nested routes. Null means "no key" — the caller
// falls back to the app name.
function titleKeyForPath(pathname, sections) {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.to === pathname) return `items.${item.key}`;
    }
  }
  const extra = extraTitleForPath(pathname);
  if (extra) return `titles.${extra}`;
  // Nested routes not covered above (e.g. a path whose section is hidden by
  // permissions): fall back to the nearest top-level item so the header still
  // reads sensibly.
  const top = '/' + pathname.split('/').filter(Boolean)[0];
  for (const section of sections) {
    for (const item of section.items) {
      if (item.to === top) return `items.${item.key}`;
    }
  }
  return null;
}

export default Layout;
