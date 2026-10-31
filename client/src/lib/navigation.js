// Single source of truth for which permission each route needs, plus the
// PANEL-BASED sidebar: the menu first lists the main panels (Evaluation,
// Cafe, Accounting, AI, Administration); selecting a panel swaps the sidebar
// to that panel's pages, with a back control (see Layout). Dashboard is the
// permanent home link above the panels.
//
// The collapsed icon rail ignores the two-level structure and shows one
// flat icon per page (kept closest to the previous behaviour).
//
// Everything below is also what the client-side route guard
// (RequirePermission via permissionForPath) and the post-login landing
// (firstAllowedPath) read, so a role — INCLUDING any new one an admin
// builds from permission keys — automatically gets a menu, page access, and
// a landing spot that match exactly what it is allowed to do.
//
// Sections and items carry stable translation `key`s; labels live in
// i18n/{fa,en}/nav.json under `panels.<key>` / `items.<key>`.

import {
  DashboardIcon,
  ResultsIcon,
  StudentsIcon,
  EvaluateIcon,
  ParametersIcon,
  GroupsIcon,
  FieldsIcon,
  UsersIcon,
  RolesIcon,
  AuditIcon,
  DownloadIcon,
  TeacherIcon,
  CalendarIcon,
  SessionIcon,
  CoffeeIcon,
  CartIcon,
  TruckIcon,
  BoxIcon,
  BarsIcon,
  LedgerIcon,
  ScaleIcon,
  BotIcon,
  TranscriptIcon,
  TaskTemplatesIcon,
  AccountsTreeIcon,
  FiscalPeriodIcon,
} from '../components/icons.jsx';

export const ROUTE_PERMISSIONS = {
  '/dashboard': 'dashboard.view',
  '/results': 'scores.view',
  '/export': 'data.export',
  '/students': 'students.view',
  '/students/import': 'data.import',
  '/evaluate': 'scores.enter',
  '/evaluate/import': 'data.import',
  '/parameters': 'parameters.manage',
  '/groups': ['groups.manage', 'groups.assign'],
  '/fields': 'fields.manage',
  '/teachers': 'teachers.view',
  '/schedule': 'schedule.view',
  '/sessions': 'schedule.view',
  '/task-templates': 'schedule.manage',
  '/cafe': 'cafe.view',
  '/cafe/products': 'cafe.view',
  '/cafe/purchases': 'cafe.supplies',
  '/cafe/inventory': 'cafe.view',
  '/cafe/reports': 'cafe.view',
  '/accounting/journal': 'accounting.view',
  '/accounting/accounts': 'accounting.view',
  '/accounting/periods': 'accounting.view',
  '/accounting/reports': 'accounting.view',
  '/agent': 'agent.view',
  '/agent/transcripts': 'agent.view',
  '/users': 'users.manage',
  '/roles': 'roles.manage',
  '/audit': 'audit.view',
  '/preferences': null,
  '/change-password': null,
};

// Dashboard: the permanent home link above the panels.
export const HOME_ITEM = {
  to: '/dashboard',
  key: 'dashboard',
  icon: DashboardIcon,
  permission: 'dashboard.view',
};

// The main panels. `key` translates via nav.json `panels.<key>`; `items` are
// the pages revealed when the panel is selected (order = display order).
export const NAV_PANELS = [
  {
    key: 'evaluation',
    items: [
      { to: '/students', key: 'students', icon: StudentsIcon },
      { to: '/evaluate', key: 'evaluate', icon: EvaluateIcon },
      { to: '/results', key: 'results', icon: ResultsIcon },
      { to: '/export', key: 'export', icon: DownloadIcon },
      { to: '/teachers', key: 'teachers', icon: TeacherIcon },
      { to: '/schedule', key: 'schedule', icon: CalendarIcon },
      { to: '/sessions', key: 'sessions', icon: SessionIcon },
      { to: '/task-templates', key: 'taskTemplates', icon: TaskTemplatesIcon },
      { to: '/parameters', key: 'parameters', icon: ParametersIcon },
    ],
  },
  {
    key: 'cafe',
    items: [
      { to: '/cafe', key: 'sales', icon: CartIcon },
      { to: '/cafe/products', key: 'products', icon: CoffeeIcon },
      { to: '/cafe/purchases', key: 'purchases', icon: TruckIcon },
      { to: '/cafe/inventory', key: 'inventory', icon: BoxIcon },
      { to: '/cafe/reports', key: 'reports', icon: BarsIcon },
    ],
  },
  {
    key: 'accounting',
    items: [
      { to: '/accounting/journal', key: 'journal', icon: LedgerIcon },
      { to: '/accounting/accounts', key: 'accounts', icon: AccountsTreeIcon },
      { to: '/accounting/reports', key: 'accountingReports', icon: ScaleIcon },
      { to: '/accounting/periods', key: 'periods', icon: FiscalPeriodIcon },
    ],
  },
  {
    key: 'ai',
    items: [
      { to: '/agent', key: 'agent', icon: BotIcon },
      { to: '/agent/transcripts', key: 'transcripts', icon: TranscriptIcon },
    ],
  },
  {
    key: 'administration',
    items: [
      { to: '/users', key: 'users', icon: UsersIcon },
      { to: '/roles', key: 'roles', icon: RolesIcon },
      { to: '/groups', key: 'groups', icon: GroupsIcon },
      { to: '/fields', key: 'fields', icon: FieldsIcon },
      { to: '/audit', key: 'audit', icon: AuditIcon },
    ],
  },
];

// Every sidebar page, flat — the collapsed icon rail and the title lookup
// walk this.
export const NAV_ITEMS = [
  HOME_ITEM,
  ...NAV_PANELS.flatMap((panel) => panel.items),
];

// Topbar titles for routes that aren't in the sidebar. Values are keys into
// the nav namespace's `titles.*` group (i18n/{fa,en}/nav.json); Layout renders
// them with t().
export const EXTRA_TITLES = {
  '/preferences': 'preferences',
  '/change-password': 'changePassword',
  '/students/import': 'importStudents',
  '/evaluate/import': 'importScores',
};

// Dynamic (parameterised) routes handled the same way: pattern → titles key.
// Checked after EXTRA_TITLES, so /students/import keeps its specific title.
const DYNAMIC_TITLES = [[/^\/students\/[^/]+$/, 'studentDetail']];

// The `titles.*` key for a non-sidebar route, or null when there is none.
export function extraTitleForPath(pathname) {
  if (pathname in EXTRA_TITLES) return EXTRA_TITLES[pathname];
  for (const [pattern, key] of DYNAMIC_TITLES) {
    if (pattern.test(pathname)) return key;
  }
  return null;
}

// The panel holding a path (nested routes like /students/:id resolve to
// their top-level page's panel), or null for the home link / non-panel pages.
export function panelForPath(pathname) {
  const top = '/' + pathname.split('/').filter(Boolean)[0];
  const page =
    NAV_ITEMS.find((item) => item.to === pathname) ??
    NAV_ITEMS.find((item) => item.to === top);
  if (!page || page === HOME_ITEM) return null;
  return NAV_PANELS.find((panel) => panel.items.includes(page)) ?? null;
}

// The permission a path needs, or `null` for "any signed-in user". Nested
// paths not listed explicitly fall back to their top-level rule.
export function permissionForPath(pathname) {
  if (pathname in ROUTE_PERMISSIONS) return ROUTE_PERMISSIONS[pathname];
  const top = '/' + pathname.split('/').filter(Boolean)[0];
  if (top in ROUTE_PERMISSIONS) return ROUTE_PERMISSIONS[top];
  return null;
}

// Checks whether a `can(key)` callback satisfies a route permission requirement
// (null = any signed-in user, string = that key, array = any of the keys).
export function hasRoutePermission(can, permission) {
  if (!permission) return true;
  if (Array.isArray(permission)) return permission.some((key) => can(key));
  return can(permission);
}

// The first place a freshly signed-in user is allowed to see. Prefers the
// dashboard (the app's home) when they can view it, otherwise walks the
// panels in order and picks the first reachable page, and finally falls back
// to Preferences — which every signed-in user can open.
export function firstAllowedPath(can) {
  if (hasRoutePermission(can, HOME_ITEM.permission)) {
    return HOME_ITEM.to;
  }
  for (const panel of NAV_PANELS) {
    for (const item of panel.items) {
      const permission = ROUTE_PERMISSIONS[item.to];
      if (hasRoutePermission(can, permission)) return item.to;
    }
  }
  return '/preferences';
}
