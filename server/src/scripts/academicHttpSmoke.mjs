// Integration workflow for a disposable, migrated database with sample users.
// TEST_SERVER_URL and DATABASE_URL must point at the same verification stack.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import pool from '../db/pool.js';

const base = process.env.TEST_SERVER_URL;
assert.ok(base, 'Set TEST_SERVER_URL for the disposable verification server');
const suffix = crypto.randomUUID().slice(0, 8);
let checks = 0;
const pass = label => console.log(`ok ${++checks} - ${label}`);
const identity = () => ({ gender: 'female', birthDate: '2005-06-15', fatherName: 'Test Father',
  nationalId: String(Math.floor(Math.random() * 9e9) + 1e9) });

async function login(username) {
  const cookies = new Map();
  const call = async (path, { method = 'GET', body, status = 200 } = {}) => {
    const response = await fetch(`${base}/api${path}`, { method,
      headers: { 'Content-Type': 'application/json', Origin: base,
        Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '),
        'X-CSRF-Token': cookies.get('csrf') ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const equal = pair.indexOf('=');
      cookies.set(pair.slice(0, equal), pair.slice(equal + 1));
    }
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return data;
  };
  await call('/auth/me', { status: 401 });
  await call('/auth/login', { method: 'POST', body: { username, password: 'sample-panel-2026' } });
  return call;
}

try {
  const admin = await login('sample-admin');
  const staff = await login('sample-staff');
  const viewer = await login('sample-viewer');
  await admin('/students', { method: 'POST', body: { fullName: 'Missing Identity' }, status: 400 });
  const student = await admin('/students', { method: 'POST', status: 201,
    body: { fullName: `HTTP Student ${suffix}`, ...identity() } });
  await admin(`/students/${student.id}`, { method: 'PATCH', body: { birthDate: null }, status: 400 });
  const renamed = await admin(`/students/${student.id}`, { method: 'PATCH', body: { fullName: `HTTP Renamed ${suffix}` } });
  assert.equal(renamed.nationalId, student.nationalId);
  const ancient = await admin(`/students/${student.id}`, { method: 'PATCH', body: { birthDate: '0099-01-01' } });
  assert.equal(ancient.birthDate, '0099-01-01');
  await admin(`/students/${student.id}`, { method: 'PATCH', body: { birthDate: '0000-01-01' }, status: 400 });
  const imported = { row: 1, fullName: `HTTP Imported ${suffix}`, ...identity() };
  const preview = await admin('/students/import', { method: 'POST', body: { rows: [imported], dryRun: true } });
  assert.equal(preview.counts.willImport, 1);
  await admin('/students/import', { method: 'POST', body: { rows: [imported] }, status: 201 });
  const duplicate = await admin('/students/import', { method: 'POST', body: { rows: [imported], dryRun: true } });
  assert.equal(duplicate.counts.willImport, 0);
  pass('required identity, sparse PATCH, early dates and duplicate import classification');

  const { group } = await admin('/groups', { method: 'POST', status: 201,
    body: { code: `HTTP-${suffix}`, name: `HTTP Group ${suffix}` } });
  await admin(`/groups/${group.id}/members`, { method: 'PUT', body: { add: [student.id], joinedOn: '2020-01-01' } });
  const members = await admin(`/groups/${group.id}/members`);
  const member = members.students.find(row => row.id === student.id);
  assert.ok(member.membershipId);
  const { membership } = await admin(`/groups/${group.id}/members/${member.membershipId}`,
    { method: 'PUT', body: { joinedOn: '2020-02-01' } });
  assert.equal(membership.joinedOn, '2020-02-01');
  assert.ok(membership.createdAt);
  const { teacher } = await admin('/teachers', { method: 'POST', status: 201,
    body: { fullName: `HTTP Teacher ${suffix}`, birthDate: '1980-01-01', nationalId: identity().nationalId } });
  const intervals = await admin('/intervals');
  const interval = intervals.intervals.find(row => row.name === 'Weekly');
  const { assignment } = await admin('/assignments', { method: 'POST', status: 201,
    body: { teacherId: teacher.id, intervalId: interval.id, groupId: group.id, anchorDate: '2026-10-26' } });
  assert.ok(assignment.code.startsWith(group.code.toUpperCase()), assignment.code);
  const planBody = { assignmentIds: [assignment.id], mode: 'sessions', count: 2 };
  const plan = await admin('/sessions/generate', { method: 'POST', body: { ...planBody, dryRun: true } });
  await admin('/sessions/generate', { method: 'POST', status: 409, body: { ...planBody, previewToken: 'stale' } });
  await admin('/sessions/generate', { method: 'POST', status: 201, body: { ...planBody, previewToken: plan.token } });
  const { sessions } = await admin(`/sessions?assignmentId=${assignment.id}`);
  assert.equal(sessions.length, 2);
  const parameterResponse = await admin('/parameters', { method: 'POST', status: 201,
    body: { code: `HTTP-${suffix}`, name: `HTTP Parameter ${suffix}`, minValue: -10, maxValue: 300 } });
  const parameter = parameterResponse.parameter ?? parameterResponse;
  const cell = { membershipId: member.membershipId, parameterId: parameter.id, selected: true,
    qualityValue: null, quantityValue: null, qualityComment: null, quantityComment: null };
  const save = (session, entries, options = {}, who = admin) => who('/evaluations/bulk',
    { method: 'PUT', body: { sessionId: session.id, entries, ...options } });
  await save(sessions[0], [cell]);
  const read = async session => (await admin(`/evaluations?sessionId=${session.id}`)).evaluations[0];
  const empty = await read(sessions[0]);
  assert.equal(empty.locksAt, null);
  assert.equal(empty.isLocked, false);
  await save(sessions[0], [{ ...cell, qualityValue: 80, quantityValue: 200, qualityComment: 'Keep comment' }]);
  const first = await read(sessions[0]);
  await save(sessions[0], [{ ...cell, quantityValue: 301 }], { dryRun: true }).then(out => assert.ok(out.problems.length));
  await save(sessions[0], [{ membershipId: cell.membershipId, parameterId: cell.parameterId, selected: true, quantityValue: 250 }], { source: 'import' });
  const patched = await read(sessions[0]);
  assert.equal(patched.qualityValue, 80);
  assert.equal(patched.qualityComment, 'Keep comment');
  assert.equal(patched.quantityValue, 250);
  assert.equal(patched.locksAt, first.locksAt);
  pass('membership dates, generated codes, session preview and independent score/import dimensions');

  await save(sessions[1], [{ ...cell, qualityValue: 20, quantityValue: 100 }]);
  const { periods } = await admin(`/periods?assignmentId=${assignment.id}`);
  assert.equal(periods.length, 1);
  const period = periods[0];
  const results = await admin(`/results?assignmentId=${assignment.id}&seq=${period.seq}`);
  const resultCell = results.rows.find(row => row.studentId === student.id).cells[parameter.id];
  assert.equal(resultCell.quality, 50);
  assert.equal(resultCell.quantity, 175);
  const scope = await admin(`/results/scope?periodIds=${period.id}`);
  assert.deepEqual(scope.grids[0].rows.find(row => row.studentId === student.id).cells[parameter.id], resultCell);
  const cube = await admin(`/export/cube?periodIds=${period.id}`);
  const cubeCell = cube.cells.find(row => row.studentId === student.id && row.parameterId === parameter.id);
  assert.equal(cubeCell.quality, 50);
  assert.equal(cubeCell.quantity, 175);
  const trends = await admin(`/dashboard/trends?groupId=${group.id}`);
  assert.equal(trends.trends.find(row => row.parameterId === parameter.id).average, 50);
  pass('Results, scoped reports, export and cohort trend agree on period means');

  await staff(`/periods/${period.id}`, { method: 'PUT', body: { archived: true }, status: 403 });
  await admin(`/periods/${period.id}`, { method: 'PUT', body: { archived: true } });
  assert.equal((await admin(`/results/scope?periodIds=${period.id}`)).grids.length, 0);
  await admin(`/periods/${period.id}`, { method: 'PUT', body: { archived: false } });
  await admin(`/evaluations/${first.id}/archive`, { method: 'PUT', body: { archived: true } });
  assert.equal((await admin(`/evaluations?sessionId=${sessions[0].id}`)).evaluations.length, 0);
  await admin(`/evaluations/${first.id}/archive`, { method: 'PUT', body: { archived: false } });
  const restored = await read(sessions[0]);
  assert.equal(restored.firstAnsweredAt, first.firstAnsweredAt);
  assert.equal(restored.locksAt, first.locksAt);
  await admin(`/groups/${group.id}/members/${member.membershipId}`,
    { method: 'PUT', body: { joinedOn: '2026-11-10' }, status: 409 });
  await admin(`/students/${student.id}`, { method: 'DELETE', status: 204 });
  await viewer(`/students/${student.id}/restore`, { method: 'PUT', status: 403 });
  await admin(`/students/${student.id}/restore`, { method: 'PUT' });
  assert.equal((await admin(`/students/${student.id}`)).nationalId, student.nationalId);
  pass('lifecycle permissions, archive visibility, recovery history and membership guards');

  await save(sessions[0], [cell]);
  await admin('/alerts/scan', { method: 'POST', body: {}, status: 201 });
  const alerts = await admin('/alerts');
  const alert = alerts.alerts.find(row => row.sessionId === sessions[0].id);
  assert.ok(alert, 'incomplete session receives an alert');
  await admin(`/alerts/${alert.id}`, { method: 'DELETE', status: 204 });
  await save(sessions[0], [{ ...cell, qualityValue: 80, quantityValue: 250, qualityComment: 'Keep comment' }]);
  await admin('/preferences', { method: 'PUT', body: { language: 'en' } });
  assert.equal((await admin('/preferences')).preferences.language, 'en');
  const audit = await admin(`/audit?category=scores&actor=sample-admin`);
  assert.ok(audit.entries.some(row => row.actor === 'sample-admin'));
  pass('alert workflow, stored preferences and HTTP audit attribution');

  const { role } = await admin('/roles', { method: 'POST', status: 201,
    body: { name: `Blind ${suffix}`, permissions: ['data.import', 'audit.view'] } });
  const username = `blind-${suffix}`;
  await pool.query(`INSERT INTO users(username,full_name,password_hash,role_id,must_change_password)
    SELECT $1,'Blind Verification',password_hash,$2,false FROM users WHERE username='sample-staff'`, [username, role.id]);
  const blind = await login(username);
  await blind(`/evaluations?sessionId=${sessions[0].id}`, { status: 403 });
  const partial = { membershipId: member.membershipId, parameterId: parameter.id, selected: true, quantityValue: 200 };
  const blindPreview = await save(sessions[0], [partial], { source: 'import', dryRun: true }, blind);
  assert.equal(blindPreview.redacted, true);
  assert.equal(blindPreview.cells[0].from, null);
  assert.deepEqual(blindPreview.cells[0].to, { selected: true, quantityValue: 200 });
  await save(sessions[0], [partial], { source: 'import' }, blind);
  assert.equal((await read(sessions[0])).qualityValue, 80);
  const hiddenAudit = await blind('/audit?category=scores');
  const scoreRows = hiddenAudit.entries.filter(row => /^(scores|evaluation)\./.test(row.action));
  assert.ok(scoreRows.length);
  assert.ok(scoreRows.every(row => row.oldData === null && row.newData === null && row.details.redacted));
  pass('blind imports preserve hidden dimensions and redact preview and audit snapshots');

  const shared = { row: 1, fullName: `Concurrent Import ${suffix}`, ...identity() };
  const concurrentImports = await Promise.allSettled([admin, blind].map(who => who('/students/import',
    { method: 'POST', body: { rows: [shared] }, status: 201 })));
  assert.equal(concurrentImports.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(concurrentImports.find(result => result.status === 'rejected').reason.message.includes('STUDENTS_IMPORT_EMPTY'));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM students WHERE national_id=$1', [shared.nationalId])).rows[0].n, 1);
  pass('simultaneous imports reclassify the losing request without duplicating an identity');

  const existing = (await pool.query('SELECT national_id FROM students WHERE id=$1', [student.id])).rows[0];
  assert.equal(existing.national_id, student.nationalId);
  if (process.env.TEST_FIXTURE_FILE) await writeFile(process.env.TEST_FIXTURE_FILE,
    JSON.stringify({ student, group, member, assignment, sessions, parameter, period }, null, 2));
  console.log(`academic HTTP smoke: all ${checks} checks passed`);
} finally { await pool.end(); }
