import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { hashPassword } from '../src/lib/passwords.js';

const BASE = process.env.TEST_SERVER_URL ?? 'http://localhost:3000';
const NIL = '00000000-0000-0000-0000-000000000000';

// This is an integration suite: it talks to a running server + database. Plain
// `npm test` (node --test) discovers every *.test.js, so gate it behind a flag
// and skip cleanly there. `npm run test-permissions` sets RUN_INTEGRATION=1.
const RUN = process.env.RUN_INTEGRATION === '1';
const skip = RUN
  ? false
  : 'integration test — start the server and run `npm run test-permissions`';

function jar() {
  const store = new Map();
  return {
    header(response) {
      const set = response.headers.getSetCookie?.() ?? [];
      for (const line of set) {
        const [pair] = line.split(';');
        const [key, value] = pair.split('=');
        store.set(key, value);
      }
    },
    cookie() {
      return [...store.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    // The double-submit CSRF token the server handed us (see middleware/csrf.js).
    csrf() {
      return store.get('csrf');
    },
  };
}

const SAFE = /^(GET|HEAD|OPTIONS)$/i;

async function call(path, { method = 'GET', body, cookieJar } = {}) {
  // Mirror the browser: echo the CSRF cookie in the header on mutations.
  const csrfHeader =
    cookieJar && !SAFE.test(method) && cookieJar.csrf()
      ? { 'X-CSRF-Token': cookieJar.csrf() }
      : {};
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieJar ? { Cookie: cookieJar.cookie() } : {}),
      ...csrfHeader,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  cookieJar?.header(response);
  return response;
}

async function loginAs(username, password) {
  const cookieJar = jar();
  const response = await call('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    cookieJar,
  });
  assert.equal(response.status, 200, `login as ${username} should succeed`);
  return cookieJar;
}

// One representative request per protected route.
const ROUTES = [
  { method: 'GET', path: '/api/students' },
  { method: 'POST', path: '/api/students', body: {} },
  { method: 'GET', path: `/api/students/${NIL}` },
  { method: 'PATCH', path: `/api/students/${NIL}`, body: { fullName: 'x' } },
  { method: 'DELETE', path: `/api/students/${NIL}` },
  { method: 'PUT', path: `/api/students/${NIL}/restore` },
  { method: 'POST', path: '/api/students/import', body: { rows: [] } },
  { method: 'GET', path: '/api/parameters' },
  { method: 'POST', path: '/api/parameters', body: {} },
  { method: 'PATCH', path: `/api/parameters/${NIL}`, body: {} },
  { method: 'GET', path: `/api/periods?assignmentId=${NIL}` },
  { method: 'PUT', path: `/api/periods/${NIL}`, body: { archived: true } },
  { method: 'GET', path: `/api/evaluations?sessionId=${NIL}` },
  { method: 'PUT', path: '/api/evaluations/bulk', body: { sessionId: NIL, entries: [] } },
  { method: 'PUT', path: `/api/evaluations/${NIL}/archive`, body: { archived: true } },
  { method: 'GET', path: `/api/results?assignmentId=${NIL}&seq=1` },
  { method: 'GET', path: '/api/dashboard/trends' },
  { method: 'GET', path: `/api/dashboard/summary?assignmentId=${NIL}&seq=1` },
  { method: 'GET', path: `/api/export/cube?assignmentId=${NIL}` },
  { method: 'GET', path: '/api/saved-views' },
  { method: 'POST', path: '/api/saved-views', body: {} },
  { method: 'PUT', path: `/api/saved-views/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/saved-views/${NIL}` },
  { method: 'GET', path: '/api/preferences' },
  { method: 'PUT', path: '/api/preferences', body: {} },
  { method: 'DELETE', path: '/api/preferences' },
  { method: 'GET', path: '/api/audit' },
  { method: 'GET', path: '/api/users' },
  { method: 'POST', path: '/api/users', body: {} },
  { method: 'PATCH', path: `/api/users/${NIL}`, body: {} },
  { method: 'POST', path: `/api/users/${NIL}/reset-password` },
  // Roles
  { method: 'GET', path: '/api/roles' },
  { method: 'GET', path: '/api/roles/catalog' },
  { method: 'POST', path: '/api/roles', body: {} },
  { method: 'PATCH', path: `/api/roles/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/roles/${NIL}` },
  // Groups
  { method: 'GET', path: '/api/groups' },
  { method: 'POST', path: '/api/groups', body: {} },
  { method: 'PATCH', path: `/api/groups/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/groups/${NIL}` },
  { method: 'GET', path: `/api/groups/${NIL}/members` },
  { method: 'PUT', path: `/api/groups/${NIL}/members`, body: { add: [], remove: [] } },
  { method: 'PUT', path: `/api/groups/${NIL}/members/${NIL}`, body: { joinedOn: '2026-01-01' } },
  // Custom fields
  { method: 'GET', path: '/api/field-definitions' },
  { method: 'POST', path: '/api/field-definitions', body: {} },
  { method: 'PATCH', path: `/api/field-definitions/${NIL}`, body: {} },
  { method: 'DELETE', path: `/api/field-definitions/${NIL}` },
  // Teachers, Schedule, Cafe, Accounting, Agent
  { method: 'GET', path: '/api/teachers' },
  { method: 'POST', path: '/api/teachers', body: { fullName: 'x' } },
  { method: 'GET', path: '/api/intervals' },
  { method: 'GET', path: '/api/assignments' },
  { method: 'GET', path: '/api/assignments/memberships' },
  { method: 'GET', path: '/api/sessions' },
  { method: 'POST', path: '/api/sessions/generate', body: {} },
  { method: 'GET', path: '/api/tasks' },
  { method: 'POST', path: '/api/tasks', body: {} },
  { method: 'POST', path: '/api/tasks/from-template', body: {} },
  { method: 'GET', path: '/api/task-templates' },
  { method: 'POST', path: '/api/task-templates', body: {} },
  { method: 'GET', path: '/api/alerts' },
  { method: 'POST', path: '/api/alerts/scan', body: {} },
  { method: 'DELETE', path: `/api/alerts/${NIL}` },
  { method: 'GET', path: '/api/cafe/products' },
  { method: 'POST', path: '/api/cafe/products', body: {} },
  { method: 'GET', path: '/api/cafe/suppliers' },
  { method: 'POST', path: '/api/cafe/suppliers', body: {} },
  { method: 'GET', path: '/api/cafe/purchases' },
  { method: 'POST', path: '/api/cafe/purchases', body: {} },
  { method: 'GET', path: '/api/cafe/sales' },
  { method: 'POST', path: '/api/cafe/sales', body: {} },
  { method: 'POST', path: `/api/cafe/sales/${NIL}/void`, body: {} },
  { method: 'GET', path: '/api/cafe/balances' },
  { method: 'GET', path: '/api/cafe/balances/students' },
  { method: 'GET', path: `/api/cafe/balances/${NIL}` },
  { method: 'POST', path: '/api/cafe/balances', body: {} },
  { method: 'GET', path: '/api/cafe/inventory' },
  { method: 'GET', path: `/api/cafe/inventory/${NIL}` },
  { method: 'POST', path: '/api/cafe/inventory', body: {} },
  { method: 'GET', path: '/api/cafe/reports' },
  { method: 'GET', path: '/api/accounting/accounts' },
  { method: 'POST', path: '/api/accounting/accounts', body: {} },
  { method: 'GET', path: '/api/accounting/mappings' },
  { method: 'PATCH', path: '/api/accounting/mappings/not-an-event', body: {} },
  { method: 'GET', path: '/api/accounting/journal' },
  { method: 'POST', path: '/api/accounting/journal', body: {} },
  { method: 'GET', path: `/api/accounting/journal/${NIL}` },
  { method: 'POST', path: `/api/accounting/journal/${NIL}/post`, body: {} },
  { method: 'POST', path: `/api/accounting/journal/${NIL}/void`, body: {} },
  { method: 'GET', path: '/api/accounting/periods' },
  { method: 'POST', path: '/api/accounting/periods', body: {} },
  { method: 'POST', path: `/api/accounting/periods/${NIL}/close`, body: {} },
  { method: 'POST', path: `/api/accounting/periods/${NIL}/reopen`, body: {} },
  { method: 'GET', path: '/api/accounting/periods/opening' },
  { method: 'POST', path: '/api/accounting/periods/opening', body: {} },
  { method: 'GET', path: '/api/accounting/reports/trial-balance' },
  { method: 'GET', path: '/api/accounting/reports/income-statement' },
  { method: 'GET', path: '/api/accounting/reports/balance-sheet' },
  { method: 'GET', path: `/api/accounting/reports/ledger?accountId=${NIL}` },
  { method: 'GET', path: '/api/agent/status' },
  { method: 'GET', path: '/api/agent/transcripts' },
];

let admin;
let staff;
let viewer;
let closeOnly;
let originalAdminPreferences;
let integrationDb;
let closeRoleId;
let closeUserId;
let originalAlerts = [];

before(async () => {
  if (!RUN) return;
  execSync('npm run migrate', { stdio: 'ignore' });
  integrationDb = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  originalAlerts = (
    await integrationDb.query(
      `SELECT id,
              resolved_at::text AS resolved_at,
              updated_at::text AS updated_at
       FROM alerts ORDER BY id`
    )
  ).rows;
  admin = await loginAs(
    process.env.TEST_ADMIN_USERNAME ?? 'sample-admin',
    process.env.TEST_ADMIN_PASSWORD ?? 'sample-panel-2026'
  );
  staff = await loginAs(
    process.env.TEST_STAFF_USERNAME ?? 'sample-staff',
    process.env.TEST_STAFF_PASSWORD ?? 'sample-panel-2026'
  );
  viewer = await loginAs(
    process.env.TEST_VIEWER_USERNAME ?? 'sample-viewer',
    process.env.TEST_VIEWER_PASSWORD ?? 'sample-panel-2026'
  );
  const preferencesResponse = await call('/api/preferences', { cookieJar: admin });
  originalAdminPreferences = (await preferencesResponse.json()).preferences;

  const suffix = Math.random().toString(36).slice(2, 10);
  closeRoleId = (
    await integrationDb.query(
      `INSERT INTO roles (name, description)
       VALUES ($1, 'Permission integration probe') RETURNING id`,
      [`Close-only probe ${suffix}`]
    )
  ).rows[0].id;
  await integrationDb.query(
    `INSERT INTO role_permissions (role_id, permission_key)
     SELECT $1, key FROM unnest($2::text[]) AS key`,
    [
      closeRoleId,
      ['accounting.view', 'accounting.enter', 'accounting.post', 'accounting.close'],
    ]
  );
  const username = `close-probe-${suffix}`;
  const password = `close-probe-password-${suffix}`;
  closeUserId = (
    await integrationDb.query(
      `INSERT INTO users
         (username, full_name, password_hash, role_id, must_change_password)
       VALUES ($1, 'Close Permission Probe', $2, $3, false)
       RETURNING id`,
      [username, await hashPassword(password), closeRoleId]
    )
  ).rows[0].id;
  closeOnly = await loginAs(username, password);
});

after(async () => {
  if (!RUN) return;
  if (originalAdminPreferences) {
    await call('/api/preferences', {
      method: 'PUT',
      body: originalAdminPreferences,
      cookieJar: admin,
    });
  }
  for (const cookieJar of [admin, staff, viewer, closeOnly]) {
    if (cookieJar) await call('/api/auth/logout', { method: 'POST', cookieJar });
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (closeUserId) {
    await integrationDb.query(
      `DELETE FROM user_sessions WHERE sess->>'userId' = $1`,
      [closeUserId]
    );
    // The audit trail is append-only; retain its actor in this throwaway DB.
    await integrationDb.query('UPDATE users SET is_active=false WHERE id=$1', [closeUserId]);
  }
  await integrationDb.query(
    `DELETE FROM alerts WHERE id <> ALL($1::uuid[])`,
    [originalAlerts.map((row) => row.id)]
  );
  if (originalAlerts.length > 0) {
    const restore = await integrationDb.connect();
    try {
      await restore.query('BEGIN');
      await restore.query('ALTER TABLE alerts DISABLE TRIGGER alerts_updated_at');
      for (const row of originalAlerts) {
        await restore.query(
          `UPDATE alerts SET resolved_at = $2, updated_at = $3 WHERE id = $1`,
          [row.id, row.resolved_at, row.updated_at]
        );
      }
      await restore.query('ALTER TABLE alerts ENABLE TRIGGER alerts_updated_at');
      await restore.query('COMMIT');
    } catch (err) {
      await restore.query('ROLLBACK');
      throw err;
    } finally {
      restore.release();
    }
  }
  await integrationDb?.end();
});

test('every route in the list refuses an unauthenticated request', { skip }, async () => {
  for (const route of ROUTES) {
    const response = await call(route.path, { method: route.method, body: route.body });
    assert.equal(
      response.status,
      401,
      `${route.method} ${route.path} should require sign-in, got ${response.status}`
    );
  }
});

test('a signed-in viewer never gets a 401, and privileged routes stay closed to staff', { skip }, async () => {
  // Routes the Staff role must NOT reach (it lacks the key): everything gated
  // by students.delete, data.import, parameters.manage,
  // users.manage, audit.view, roles.manage, groups.manage, fields.manage.
  // GET /api/roles(+/catalog) is guarded inside the router by users.manage OR
  // roles.manage, so staff gets 403 there too.
  const adminOnly = new Set([
    `DELETE /api/students/${NIL}`,
    `PUT /api/students/${NIL}/restore`,
    `PUT /api/periods/${NIL}`,
    `DELETE /api/alerts/${NIL}`,
    'POST /api/students/import',
    'POST /api/parameters',
    `PATCH /api/parameters/${NIL}`,
    'GET /api/audit',
    'GET /api/users',
    'POST /api/users',
    `PATCH /api/users/${NIL}`,
    `POST /api/users/${NIL}/reset-password`,
    'GET /api/roles',
    'GET /api/roles/catalog',
    'POST /api/roles',
    `PATCH /api/roles/${NIL}`,
    `DELETE /api/roles/${NIL}`,
    'POST /api/groups',
    `PATCH /api/groups/${NIL}`,
    `DELETE /api/groups/${NIL}`,
    'POST /api/field-definitions',
    `PATCH /api/field-definitions/${NIL}`,
    `DELETE /api/field-definitions/${NIL}`,
    'GET /api/teachers',
    'POST /api/teachers',
    'GET /api/intervals',
    'POST /api/sessions/generate',
    'POST /api/tasks',
    'POST /api/tasks/from-template',
    'GET /api/task-templates',
    'POST /api/task-templates',
    'GET /api/alerts',
    'POST /api/alerts/scan',
    'GET /api/cafe/products',
    'POST /api/cafe/products',
    'GET /api/cafe/suppliers',
    'POST /api/cafe/suppliers',
    'GET /api/cafe/purchases',
    'POST /api/cafe/purchases',
    'GET /api/cafe/sales',
    'POST /api/cafe/sales',
    `POST /api/cafe/sales/${NIL}/void`,
    'GET /api/cafe/balances',
    'GET /api/cafe/balances/students',
    `GET /api/cafe/balances/${NIL}`,
    'POST /api/cafe/balances',
    'GET /api/cafe/inventory',
    `GET /api/cafe/inventory/${NIL}`,
    'POST /api/cafe/inventory',
    'GET /api/cafe/reports',
    'GET /api/accounting/accounts',
    'POST /api/accounting/accounts',
    'GET /api/accounting/mappings',
    'PATCH /api/accounting/mappings/not-an-event',
    'GET /api/accounting/journal',
    'POST /api/accounting/journal',
    `GET /api/accounting/journal/${NIL}`,
    `POST /api/accounting/journal/${NIL}/post`,
    `POST /api/accounting/journal/${NIL}/void`,
    'GET /api/accounting/periods',
    'POST /api/accounting/periods',
    `POST /api/accounting/periods/${NIL}/close`,
    `POST /api/accounting/periods/${NIL}/reopen`,
    'GET /api/accounting/periods/opening',
    'POST /api/accounting/periods/opening',
    'GET /api/accounting/reports/trial-balance',
    'GET /api/accounting/reports/income-statement',
    'GET /api/accounting/reports/balance-sheet',
    `GET /api/accounting/reports/ledger?accountId=${NIL}`,
    'GET /api/agent/status',
    'GET /api/agent/transcripts',
  ]);

  for (const route of ROUTES) {
    const asViewer = await call(route.path, {
      method: route.method,
      body: route.body,
      cookieJar: viewer,
    });
    assert.notEqual(
      asViewer.status,
      401,
      `${route.method} ${route.path} rejected a signed-in viewer entirely`
    );

    const key = `${route.method} ${route.path}`;
    if (adminOnly.has(key)) {
      const asStaff = await call(route.path, {
        method: route.method,
        body: route.body,
        cookieJar: staff,
      });
      assert.equal(
        asStaff.status,
        403,
        `${key} should be closed to staff, but staff got ${asStaff.status}`
      );
    }
  }
});

test('staff can assign group members (groups.assign), even though they cannot manage groups', { skip }, async () => {
  const response = await call(`/api/groups/${NIL}/members`, {
    method: 'PUT',
    body: { add: [], remove: [] },
    cookieJar: staff,
  });
  assert.notEqual(response.status, 401, 'staff is signed in');
  assert.notEqual(
    response.status,
    403,
    `staff should hold groups.assign, got ${response.status}`
  );
});

test('schema-4 score roles can read assignment/session context', { skip }, async () => {
  for (const [label, cookieJar] of [['viewer', viewer], ['staff', staff]]) {
    for (const path of ['/api/assignments', '/api/sessions']) {
      const response = await call(path, { cookieJar });
      assert.notEqual(response.status, 401, `${label} is signed in`);
      assert.notEqual(response.status, 403, `${label} needs ${path} for score pages`);
    }
  }
});

test('accounting.close works without unrelated accounting.manage', { skip }, async () => {
  const response = await call(`/api/accounting/periods/${NIL}/close`, {
    method: 'POST',
    cookieJar: closeOnly,
  });
  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403, 'accounting.close must reach its route guard');
});

test('admin can reach every route without a permission error', { skip }, async () => {
  for (const route of ROUTES) {
    const response = await call(route.path, {
      method: route.method,
      body: route.body,
      cookieJar: admin,
    });
    assert.notEqual(response.status, 401, `${route.method} ${route.path} rejected admin`);
    assert.notEqual(response.status, 403, `${route.method} ${route.path} rejected admin`);
  }
});
