import connectPgSimple from 'connect-pg-simple';
import express from 'express';
import { startAlertScanner } from './lib/alerts.js';
import session from 'express-session';
import pool from './db/pool.js';
import { attachUser, authorize, requireLogin, requirePermission } from './middleware/auth.js';
import { auditRequests } from './middleware/audit.js';
import { createCsrf } from './middleware/csrf.js';
import { createDatabaseReadiness } from './middleware/databaseReady.js';
import auditRouter from './routes/audit.js';
import authRouter from './routes/auth.js';
import evaluationsRouter from './routes/evaluations.js';
import parametersRouter from './routes/parameters.js';
import periodsRouter from './routes/periods.js';
import studentsRouter from './routes/students.js';
import usersRouter from './routes/users.js';
import preferencesRouter from './routes/preferences.js';
import resultsRouter from './routes/results.js';
import savedViewsRouter from './routes/savedViews.js';
import dashboardRouter from './routes/dashboard.js';
import exportRouter from './routes/export.js';
import rolesRouter from './routes/roles.js';
import groupsRouter from './routes/groups.js';
import fieldDefinitionsRouter from './routes/fieldDefinitions.js';
import teachersRouter from './routes/teachers.js';
import intervalsRouter from './routes/intervals.js';
import assignmentsRouter from './routes/assignments.js';
import sessionsRouter from './routes/sessions.js';
import tasksRouter from './routes/tasks.js';
import taskTemplatesRouter from './routes/taskTemplates.js';
import alertsRouter from './routes/alerts.js';
import cafeProductsRouter from './routes/cafeProducts.js';
import cafeSuppliersRouter from './routes/cafeSuppliers.js';
import cafePurchasesRouter from './routes/cafePurchases.js';
import cafeSalesRouter from './routes/cafeSales.js';
import cafeBalancesRouter from './routes/cafeBalances.js';
import cafeInventoryRouter from './routes/cafeInventory.js';
import cafeReportsRouter from './routes/cafeReports.js';
import accountingAccountsRouter from './routes/accountingAccounts.js';
import accountingMappingsRouter from './routes/accountingMappings.js';
import accountingJournalRouter from './routes/accountingJournal.js';
import accountingPeriodsRouter from './routes/accountingPeriods.js';
import accountingReportsRouter from './routes/accountingReports.js';
import agentRouter from './routes/agent.js';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  console.error(
    'SESSION_SECRET is missing or too short. Add a line like ' +
      'SESSION_SECRET=<64 random characters> to server/.env, then restart.'
  );
  process.exit(1);
}

// Whether the session cookie carries the Secure flag (only ever sent over
// HTTPS). Behind a TLS-terminating reverse proxy, 'auto' does the right thing
// because we trust one proxy hop and read X-Forwarded-Proto. Set
// SESSION_COOKIE_SECURE=true to force it on (recommended once you always serve
// over HTTPS — it stops a misconfigured proxy from ever downgrading the cookie
// to plain HTTP), or =false only for a deliberately HTTP-only LAN box.
function readCookieSecure() {
  const raw = (process.env.SESSION_COOKIE_SECURE ?? 'auto').trim().toLowerCase();
  if (raw === 'auto' || raw === '') return 'auto';
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  console.error(
    `SESSION_COOKIE_SECURE must be 'auto', 'true' or 'false' (got "${raw}").`
  );
  process.exit(1);
}
const cookieSecure = readCookieSecure();

// Whether to enforce the CSRF Origin/Referer check. It must be OFF in
// development, where the Vite dev server (a different origin, e.g. :5173)
// proxies /api here — a legitimately cross-origin request that the check would
// otherwise reject, blocking login. The double-submit token still runs in every
// mode, so development keeps CSRF protection either way. Default 'auto' enables
// it only when NODE_ENV=production; CSRF_CHECK_ORIGIN=true/false forces it.
function readCheckOrigin() {
  const raw = (process.env.CSRF_CHECK_ORIGIN ?? 'auto').trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return process.env.NODE_ENV === 'production';
}
const enforceCsrfOrigin = readCheckOrigin();
const csrfAllowedOrigins = (process.env.CSRF_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// How many proxy hops to trust for X-Forwarded-* headers. Default OFF: when the
// app is exposed directly on the LAN (no proxy), trusting those headers would
// let any client spoof its IP (polluting the audit log) or claim HTTPS. Set
// TRUST_PROXY=1 when you put it behind ONE reverse proxy (see the deploy docs);
// a number is a hop count, 'true'/'false' toggle it, and any other string is
// passed through to Express (e.g. 'loopback' or a CIDR).
function readTrustProxy() {
  const raw = (process.env.TRUST_PROXY ?? '').trim();
  const lower = raw.toLowerCase();
  if (lower === '' || lower === 'false' || lower === '0') return false;
  if (lower === 'true') return true;
  const hops = Number(raw);
  if (Number.isInteger(hops) && hops >= 0) return hops;
  return raw;
}

const PgSession = connectPgSimple(session);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', readTrustProxy());
// Content-Security-Policy. The built client bundles all of its own JS/CSS —
// nothing is loaded from a CDN — so scripts can stay strict ('self', no inline,
// no eval), which is the important defence against injected <script>. Styles
// allow 'unsafe-inline' because React (and recharts) set element style
// attributes at runtime, which there is no static way to hash from a prebuilt
// index.html; this is the standard, low-risk trade-off for a bundled SPA.
// In development the HTML is served by the Vite dev server, not this process,
// so these directives only ever apply to the production build served here.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
// Query strings contain student-name searches and report filters. Keep those
// out of access logs while retaining the useful method/path/status metadata.
morgan.token('path-only', (req) => req.originalUrl.split('?')[0]);
const accessLogFormat =
  process.env.NODE_ENV === 'production'
    ? ':remote-addr - :remote-user [:date[clf]] ":method :path-only HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"'
    : ':method :path-only :status :response-time ms - :res[content-length]';
app.use(morgan(accessLogFormat));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// In production the built React app (client/dist) is served by this same
// process, so there is only one thing to run. In development you instead run
// the Vite dev server, which proxies /api here, and this block is skipped.
const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/dist'
);
const serveClient = fs.existsSync(path.join(clientDist, 'index.html'));
if (serveClient) {
  // Hashed asset files can be cached hard; index.html must not be (it points
  // at the current hashes), so it is sent by the SPA fallback with no cache.
  app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
}

const databaseReady = createDatabaseReadiness({
  pool,
  migrations: fs.readdirSync(path.join(import.meta.dirname, 'db/migrations'))
    .filter(filename => filename.endsWith('.sql')).sort(),
});
app.get('/api/health', databaseReady.health);
app.use('/api', databaseReady.requireReady);

app.use(
  session({
    store: new PgSession({ pool, tableName: 'user_sessions' }),
    name: 'sid',
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);
app.use('/api', attachUser);

// CSRF: hand out the token cookie to everyone (so it exists before login), and
// run the Origin check early enough to also cover the login route. The
// double-submit token check is mounted after requireLogin below, so an
// unauthenticated mutation still fails as a plain 401.
const csrf = createCsrf({
  secure: cookieSecure,
  enforceOrigin: enforceCsrfOrigin,
  allowedOrigins: csrfAllowedOrigins,
});
app.use('/api', csrf.issue);
app.use('/api', csrf.checkOrigin);

app.use('/api', auditRequests);

app.use('/api/auth', authRouter);
app.use('/api', requireLogin);
app.use('/api', csrf.verifyToken);

app.use('/api/students/import', authorize({ POST: 'data.import' }));

app.use(
  '/api/students',
  authorize({
    GET: 'students.view',
    POST: 'students.create',
    PATCH: 'students.edit',
    DELETE: 'students.delete',
    PUT: 'students.delete',
  }),
  studentsRouter
);
app.use(
  '/api/parameters',
  authorize({ GET: 'parameters.view', POST: 'parameters.manage', PATCH: 'parameters.manage' })
);
app.use('/api', parametersRouter);
// The period calendar carries no dedicated key — any signed-in user needs it
// for the app to function. `true` means just login.
app.use('/api/periods', authorize({ GET: true, PUT: 'scores.override' }));
app.use('/api', periodsRouter);
app.use('/api/evaluations', authorize({ GET: 'scores.view', PUT: 'scores.enter' }));
app.use('/api', evaluationsRouter);
app.use('/api/audit', authorize({ GET: 'audit.view' }), auditRouter);
app.use(
  '/api/users',
  authorize({ GET: 'users.manage', POST: 'users.manage', PATCH: 'users.manage' }),
  usersRouter
);
// The role list is readable by anyone who can manage users (to assign roles)
// or manage roles. Writes are gated inside the router by roles.manage.
app.use(
  '/api/roles',
  authorize({
    GET: true,
    POST: 'roles.manage',
    PATCH: 'roles.manage',
    DELETE: 'roles.manage',
  }),
  rolesRouter
);
app.use(
  '/api/groups',
  authorize({
    GET: 'students.view',
    POST: 'groups.manage',
    PATCH: 'groups.manage',
    PUT: 'groups.assign',
    DELETE: 'groups.manage',
  }),
  groupsRouter
);
app.use(
  '/api/field-definitions',
  authorize({
    GET: 'students.view',
    POST: 'fields.manage',
    PATCH: 'fields.manage',
    DELETE: 'fields.manage',
  }),
  fieldDefinitionsRouter
);
app.use(
  '/api/teachers',
  authorize({
    GET: 'teachers.view',
    POST: 'teachers.manage',
    PATCH: 'teachers.manage',
    DELETE: 'teachers.manage',
  }),
  teachersRouter
);
app.use(
  '/api/intervals',
  authorize({
    GET: 'schedule.view',
    POST: 'schedule.manage',
    PATCH: 'schedule.manage',
    DELETE: 'schedule.manage',
  }),
  intervalsRouter
);
app.use(
  '/api/assignments',
  authorize({
    GET: ['schedule.view', 'scores.enter', 'scores.view', 'dashboard.view', 'data.export'],
    POST: 'schedule.manage',
    PATCH: 'schedule.manage',
    DELETE: 'schedule.manage',
  }),
  assignmentsRouter
);
app.use(
  '/api/sessions',
  authorize({
    GET: ['schedule.view', 'scores.enter', 'scores.view', 'dashboard.view', 'data.export'],
    POST: 'schedule.manage',
    PATCH: 'schedule.manage',
  }),
  sessionsRouter
);
app.use(
  '/api/tasks',
  authorize({
    GET: ['schedule.view', 'scores.enter', 'scores.view'],
    POST: 'schedule.manage',
    PATCH: ['schedule.manage', 'scores.enter'],
    DELETE: 'schedule.manage',
  }),
  tasksRouter
);
app.use(
  '/api/task-templates',
  authorize({
    GET: 'schedule.view',
    POST: 'schedule.manage',
    PATCH: 'schedule.manage',
    DELETE: 'schedule.manage',
  }),
  taskTemplatesRouter
);
app.use(
  '/api/alerts',
  authorize({
    GET: 'schedule.view',
    POST: 'schedule.manage',
    PATCH: 'schedule.manage',
    DELETE: 'schedule.manage',
  }),
  alertsRouter
);
app.use(
  '/api/cafe/products',
  authorize({
    GET: 'cafe.view',
    POST: 'cafe.manage',
    PATCH: 'cafe.manage',
    DELETE: 'cafe.manage',
  }),
  cafeProductsRouter
);
app.use(
  '/api/cafe/suppliers',
  authorize({
    GET: 'cafe.supplies',
    POST: 'cafe.supplies',
    PATCH: 'cafe.supplies',
    DELETE: 'cafe.supplies',
  }),
  cafeSuppliersRouter
);
app.use(
  '/api/cafe/purchases',
  authorize({
    GET: 'cafe.supplies',
    POST: 'cafe.supplies',
  }),
  cafePurchasesRouter
);
app.use(
  '/api/cafe/sales',
  authorize({
    GET: 'cafe.view',
    POST: 'cafe.sell',
  }),
  cafeSalesRouter
);
// The balances router checks cafe.sell OR cafe.balance itself (the POS finds
// students and shows balances without students.view — the blind-entry
// precedent), so the mount only requires a session.
app.use(
  '/api/cafe/balances',
  authorize({ GET: true, POST: true }),
  cafeBalancesRouter
);
app.use(
  '/api/cafe/inventory',
  authorize({
    GET: 'cafe.view',
    POST: 'cafe.inventory',
  }),
  cafeInventoryRouter
);
app.use('/api/cafe/reports', authorize({ GET: 'cafe.view' }), cafeReportsRouter);
// The accounting ladder: anyone with accounting.view reads; entering,
// posting, closing and managing stack on top (see lib/permissions.js).
app.use(
  '/api/accounting/accounts',
  authorize({
    GET: 'accounting.view',
    POST: 'accounting.manage',
    PATCH: 'accounting.manage',
    DELETE: 'accounting.manage',
  }),
  accountingAccountsRouter
);
app.use(
  '/api/accounting/mappings',
  authorize({
    GET: 'accounting.view',
    PATCH: 'accounting.manage',
  }),
  accountingMappingsRouter
);
app.use(
  '/api/accounting/journal',
  authorize({
    GET: 'accounting.view',
    POST: 'accounting.enter',
  }),
  accountingJournalRouter
);
app.use(
  '/api/accounting/periods',
  authorize({
    GET: 'accounting.view',
    // POST actions have different authorities: create/opening use manage
    // (opening also needs post), while close/reopen use accounting.close.
    // Route-level guards below keep those independent custom-role ladders.
    POST: true,
    PATCH: 'accounting.manage',
  }),
  accountingPeriodsRouter
);
app.use(
  '/api/accounting/reports',
  authorize({ GET: 'accounting.view' }),
  accountingReportsRouter
);
app.use('/api/agent', authorize({ GET: 'agent.view' }), agentRouter);
app.use(
  '/api/preferences',
  authorize({ GET: true, PUT: true, DELETE: true }),
  preferencesRouter
);
app.use('/api/results', authorize({ GET: 'scores.view' }), resultsRouter);
app.use('/api/dashboard', authorize({ GET: 'dashboard.view' }), dashboardRouter);
// The Export Center reads the scores cube. `data.export` gates the feature, but
// its only prerequisite is `students.view`, so on its own it would let a role
// read scores that `scores.view` is meant to protect. Require BOTH here so the
// cube can never become a way around the scores.view gate on /api/results.
app.use(
  '/api/export',
  authorize({ GET: 'data.export', POST: 'data.export' }),
  requirePermission('scores.view'),
  exportRouter
);
app.use(
  '/api/saved-views',
  authorize({ GET: true, POST: true, PUT: true, DELETE: true }),
  savedViewsRouter
);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
});

// Anything that is not an API call is a client-side route: hand back the app
// shell and let React Router take over. Unknown non-GET requests fall through.
if (serveClient) {
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    // index.html points at the hashed assets — it must always revalidate, or
    // a redeploy serves stale shells for as long as the cache lives.
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (/^\/api\/(students|groups|teachers|parameters|assignments|sessions|periods|evaluations|tasks|task-templates|intervals)(\/|$)/.test(req.path)
      && ['23514', '23505', '23503', '40001'].includes(err.code)) {
    return res.status(409).json({
      error: 'This change conflicts with required identity or retained academic history.',
      code: err.code === '23505' ? 'VALIDATION_NOT_UNIQUE' : 'ACADEMIC_HISTORY_CONFLICT',
    });
  }
  const closedPeriod = /(?:post|void).*closed fiscal period/i.test(String(err?.message));
  const malformedJson = err?.type === 'entity.parse.failed';
  const tooLarge = err?.type === 'entity.too.large';
  const status = closedPeriod ? 409 : malformedJson ? 400 : tooLarge ? 413 : (err.status || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: closedPeriod
      ? 'That transaction falls in a closed fiscal period.'
      : malformedJson
        ? 'The request body is not valid JSON.'
        : tooLarge
          ? 'The request body is too large.'
          : status >= 500 ? 'Something went wrong on the server.' : err.message,
    // Forward a machine-readable code (and its translation params) when the
    // error carries one; JSON serialization drops the keys when undefined.
    code: closedPeriod
      ? 'ACCOUNTING_PERIOD_CLOSED'
      : malformedJson
        ? 'VALIDATION_INVALID_JSON'
        : tooLarge
          ? 'VALIDATION_TOO_LARGE'
          : err.code,
    params: err.params,
  });
});

const port = process.env.PORT || 3000;
// Bind to all interfaces by default so other machines on the LAN can reach it.
// Set HOST=127.0.0.1 in .env to keep it to this computer only.
const host = process.env.HOST || '0.0.0.0';
const readiness = await databaseReady.check();
const stopAlertScanner = readiness.ok ? startAlertScanner(pool) : async () => {};
process.once('SIGTERM', async () => { await stopAlertScanner(); await pool.end(); process.exit(0); });
process.once('SIGINT', async () => { await stopAlertScanner(); await pool.end(); process.exit(0); });
if (!readiness.ok) console.error(`${readiness.code}: ${readiness.error}`);
app.listen(port, host, () => {
  const shown = host === '0.0.0.0' ? 'this machine on your network' : host;
  console.log(`Server running on port ${port} (${shown})`);
});
