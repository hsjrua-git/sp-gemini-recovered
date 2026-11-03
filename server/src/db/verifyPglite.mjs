// Phase 1 de-risk: prove the existing Postgres migrations (001-015) apply cleanly
// on PGlite (Postgres-in-WASM), and that core runtime behaviour the app relies on
// — gen_random_uuid(), now() defaults, CHECK constraints, lower()/partial unique
// indexes, the seeded roles and the migration-015 permission tweak — works too.
//
// Runs against a FRESH IN-MEMORY database every time (no dataDir), so it never
// touches any real data and can be re-run freely.
//
//   node server/src/db/verifyPglite.mjs
//
// Exit code 0 = everything passed; 1 = something failed (details printed above).

import fs from 'node:fs/promises';
import path from 'node:path';
import { createPglitePool } from './pglite.js';
import { reset as runResetData, counts as resetCounts } from '../scripts/resetData.js';

const migrationsDir = path.join(import.meta.dirname, 'migrations');

const pass = (msg) => console.log(`  ✓ ${msg}`);
let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};

// Assert that a query rejects (used to prove CHECK / unique constraints fire).
async function expectReject(pool, label, sql, params) {
  try {
    await pool.query(sql, params);
    fail(`${label} — expected a constraint error, but the statement succeeded`);
  } catch {
    pass(`${label} — correctly rejected`);
  }
}

async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();

  console.log(`Applying ${files.length} migration(s) on PGlite:`);
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql); // multi-statement -> routed through PGlite exec()
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      pass(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      fail(`failed on ${file}: ${err.message}`);
      throw err; // stop the run; later migrations depend on earlier ones
    } finally {
      client.release();
    }
  }
}

const num = (result) => Number(result.rows[0].count);

async function runSanityChecks(pool) {
  console.log('\nRuntime sanity checks:');

  // gen_random_uuid() default + now() default on insert.
  const inserted = await pool.query(
    `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
     VALUES ('23456789', 'Test Student','female','2000-01-01','Test Father','1000000001')
     RETURNING id, created_at`,
  );
  const { id, created_at: createdAt } = inserted.rows[0];
  if (/^[0-9a-f-]{36}$/i.test(id)) pass(`gen_random_uuid() produced a uuid (${id})`);
  else fail(`gen_random_uuid() returned an unexpected id: ${id}`);
  if (createdAt) pass('now() default populated created_at');
  else fail('created_at was not defaulted');

  // CHECK constraints fire (invalid code has forbidden chars; regex must reject).
  await expectReject(
    pool,
    'student_code_format CHECK',
    `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
     VALUES ('00000000', 'Bad Code','female','2000-01-01','Test Father','1000000002')`,
  );

  // Seeded roles from migrations 010, 026 (Accountant), and 027 (Kiosk).
  const roleCount = num(await pool.query(`SELECT COUNT(*)::int AS count FROM roles`));
  if (roleCount === 5) pass('five system roles seeded (Administrator, Staff, Viewer, Accountant, Kiosk)');
  else fail(`expected 5 seeded roles, found ${roleCount}`);

  // Migration 015: Viewer lost data.export; Staff kept it.
  const viewerExport = num(
    await pool.query(
      `SELECT COUNT(*)::int AS count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE lower(r.name) = 'viewer' AND rp.permission_key = 'data.export'`,
    ),
  );
  const staffExport = num(
    await pool.query(
      `SELECT COUNT(*)::int AS count FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE lower(r.name) = 'staff' AND rp.permission_key = 'data.export'`,
    ),
  );
  if (viewerExport === 0) pass('migration 015 removed data.export from Viewer');
  else fail('Viewer still has data.export after migration 015');
  if (staffExport === 1) pass('Staff retains data.export');
  else fail(`Staff data.export missing (found ${staffExport})`);
  const systemScoreSchedule = num(
    await pool.query(
      `SELECT count(*)::int AS count
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       WHERE lower(r.name) IN ('staff', 'viewer')
         AND rp.permission_key = 'schedule.view'`,
    ),
  );
  if (systemScoreSchedule === 0) pass('score roles keep minimal schedule context');
  else fail(`found ${systemScoreSchedule} over-granted score-role schedule permission(s)`);
  const retiredPermissions = num(
    await pool.query(
      `SELECT count(*)::int AS count FROM role_permissions
       WHERE permission_key IN ('views.share', 'settings.manage')`,
    ),
  );
  if (retiredPermissions === 0) pass('schema-4 retired permission rows removed');
  else fail(`found ${retiredPermissions} retired permission row(s)`);

  const parsedTypes = await pool.query(
    `SELECT date '2026-10-28' AS day, interval '1 month 7 days' AS rhythm`,
    [],
  );
  if (parsedTypes.rows[0].day === '2026-10-28') pass('date parser keeps YYYY-MM-DD text');
  else fail(`date parser returned ${String(parsedTypes.rows[0].day)}`);
  if (parsedTypes.rows[0].rhythm?.months === 1 && parsedTypes.rows[0].rhythm?.days === 7) {
    pass('interval parser matches pg object shape');
  } else fail(`interval parser returned ${JSON.stringify(parsedTypes.rows[0].rhythm)}`);

  // Partial unique index on live top-level group names (lower()) + self-parent CHECK.
  const alphaGroup = await pool.query(
    `INSERT INTO student_groups (name, code) VALUES ('Alpha', 'alpha-1') RETURNING id`,
  );
  await expectReject(
    pool,
    'student_groups top-level name unique index',
    `INSERT INTO student_groups (name, code) VALUES ('alpha', 'alpha-2')`,
  );
  await expectReject(
    pool,
    'student_groups group_not_own_parent CHECK',
    `UPDATE student_groups SET parent_id = $1 WHERE id = $1`,
    [alphaGroup.rows[0].id],
  );
  const betaGroup = await pool.query(
    `INSERT INTO student_groups (name, code) VALUES ('Beta', 'beta-1') RETURNING id`,
  );
  await pool.query('UPDATE student_groups SET parent_id = $2 WHERE id = $1', [
    alphaGroup.rows[0].id,
    betaGroup.rows[0].id,
  ]);
  await expectReject(
    pool,
    'student_groups multi-hop cycle trigger',
    'UPDATE student_groups SET parent_id = $2 WHERE id = $1',
    [betaGroup.rows[0].id, alphaGroup.rows[0].id],
  );

  // Fiscal period overlap trigger from migration 030.
  await pool.query(
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
     VALUES ('FY 1404', '2025-03-21', '2026-03-20')`,
  );
  await expectReject(
    pool,
    'acct_fiscal_periods overlap trigger',
    `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
     VALUES ('Overlap FY', '2026-01-01', '2026-06-01')`,
  );

  // lower(username) unique index on users (needs a real role_id, NOT NULL).
  const adminId = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'administrator'`)
  ).rows[0].id;
  const staffId = (
    await pool.query(`SELECT id FROM roles WHERE lower(name) = 'staff'`)
  ).rows[0].id;
  await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('coach', 'Coach', 'x', $1)`,
    [adminId],
  );
  await expectReject(
    pool,
    'users username unique index',
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('coach', 'Coach Two', 'x', $1)`,
    [adminId],
  );

  // Verify resetData wipes non-admin users even when they created cafe/accounting records.
  const staffUser = await pool.query(
    `INSERT INTO users (username, full_name, password_hash, role_id)
     VALUES ('staff1', 'Staff One', 'x', $1) RETURNING id`,
    [staffId],
  );

  // Adapted schema-4 runtime guards: membership/target validity, lock override,
  // session lifecycle/identity, task targeting, and completion helpers.
  const membership = await pool.query(
    `INSERT INTO student_group_members (student_id, group_id, joined_on)
     VALUES ($1, $2, '2026-01-01') RETURNING id`,
    [id, alphaGroup.rows[0].id],
  );
  const teacher = await pool.query(
    `INSERT INTO teachers (code, full_name, birth_date, national_id)
     VALUES ('2345678A', 'Schema Teacher', '1980-01-01', '1234567890')
     RETURNING id`,
  );
  const interval = await pool.query(
    `SELECT id FROM intervals ORDER BY sort_order LIMIT 1`,
  );
  const assignment = await pool.query(
    `INSERT INTO assignments
       (code, name, teacher_id, interval_id, group_id, anchor_date)
     VALUES ('SCHEMA4', 'Schema 4 probe', $1, $2, $3, '2026-10-28')
     RETURNING id`,
    [teacher.rows[0].id, interval.rows[0].id, alphaGroup.rows[0].id],
  );
  const session = await pool.query(
    `INSERT INTO sessions (assignment_id, planned_date)
     VALUES ($1, '2026-10-28') RETURNING id, seq, code`,
    [assignment.rows[0].id],
  );
  if (session.rows[0].seq === 1 && session.rows[0].code === 'SCHEMA4-001') {
    pass('schema-4 session identity generated in the database');
  } else fail(`unexpected generated session identity ${JSON.stringify(session.rows[0])}`);
  const parameter = await pool.query(
    `INSERT INTO parameters (code, name, min_value, max_value, sort_order)
     VALUES ('SCHEMA4-P', 'Schema parameter', 0, 100, 500) RETURNING id`,
  );
  const evaluation = await pool.query(
    `INSERT INTO evaluations
       (session_id, parameter_id, membership_id, locks_at)
     VALUES ($1, $2, $3, now() + interval '1 day') RETURNING id`,
    [session.rows[0].id, parameter.rows[0].id, membership.rows[0].id],
  );
  const pendingComplete = await pool.query(
    `SELECT session_is_complete($1) AS complete,
            period_id IS NULL AS outside_period
     FROM sessions WHERE id = $1`,
    [session.rows[0].id],
  );
  if (
    pendingComplete.rows[0].complete === false &&
    pendingComplete.rows[0].outside_period === true
  ) pass('selected empty cell is incomplete and outside every period');
  else fail('selected empty cell was incorrectly complete');
  const emptyDeadline = await pool.query('SELECT locks_at FROM evaluations WHERE id=$1', [evaluation.rows[0].id]);
  if (emptyDeadline.rows[0].locks_at === null) pass('unanswered selection has no lock deadline');
  else fail('unanswered selection was locked');
  await pool.query('DELETE FROM evaluations WHERE id=$1', [evaluation.rows[0].id]);
  await pool.query('UPDATE sessions SET moved_to=current_date-20 WHERE id=$1', [session.rows[0].id]);
  await pool.query('UPDATE student_group_members SET joined_on=current_date-30 WHERE id=$1', [membership.rows[0].id]);
  await pool.query(
    `INSERT INTO evaluations (id,session_id,parameter_id,membership_id,quality_value,first_answered_at)
     VALUES ($1,$2,$3,$4,70,now()-interval '2 days')`,
    [evaluation.rows[0].id,session.rows[0].id,parameter.rows[0].id,membership.rows[0].id],
  );
  await expectReject(
    pool,
    'locked evaluation needs override reason',
    `UPDATE evaluations SET quality_value = 80 WHERE id = $1`,
    [evaluation.rows[0].id],
  );
  const overrideClient = await pool.connect();
  try {
    await overrideClient.query('BEGIN');
    await overrideClient.query(
      `SELECT set_config('app.override_reason', 'schema verifier', true)`,
    );
    await overrideClient.query(
      `UPDATE evaluations SET quality_value = 80 WHERE id = $1`,
      [evaluation.rows[0].id],
    );
    await overrideClient.query('COMMIT');
    pass('written override unlocks the schema-4 update');
  } catch (err) {
    await overrideClient.query('ROLLBACK');
    fail(`written override failed: ${err.message}`);
  } finally {
    overrideClient.release();
  }
  const attachedPeriod = await pool.query(
    `SELECT p.seq
     FROM sessions s
     JOIN periods p ON p.id = s.period_id
     WHERE s.id = $1`,
    [session.rows[0].id],
  );
  if (attachedPeriod.rows[0]?.seq === 1) pass('first answer attaches the session to period 1');
  else fail('answered session was not attached to period 1');
  await expectReject(
    pool,
    'session with active cells cannot be canceled',
    `UPDATE sessions SET canceled_at = now() WHERE id = $1`,
    [session.rows[0].id],
  );
  await pool.query(`UPDATE sessions SET archived_at = now() WHERE id = $1`, [
    session.rows[0].id,
  ]);
  const detached = await pool.query(`SELECT period_id FROM sessions WHERE id = $1`, [
    session.rows[0].id,
  ]);
  if (detached.rows[0].period_id === null) pass('archiving detaches answered history');
  else fail('archived session still occupied a period');
  await pool.query(`UPDATE sessions SET archived_at = NULL WHERE id = $1`, [
    session.rows[0].id,
  ]);
  const reattached = await pool.query(`SELECT period_id FROM sessions WHERE id = $1`, [
    session.rows[0].id,
  ]);
  if (reattached.rows[0].period_id !== null) pass('restoring answered history reattaches it');
  else fail('restored answered session did not reattach');
  await expectReject(
    pool,
    'session identity is immutable',
    `UPDATE sessions SET code = 'NOPE' WHERE id = $1`,
    [session.rows[0].id],
  );
  const individual = await pool.query(
    `INSERT INTO assignments
       (code, name, teacher_id, interval_id, membership_id, anchor_date)
     VALUES ('SCHEMA4-I', 'Individual probe', $1, $2, $3, '2026-10-29')
     RETURNING id`,
    [teacher.rows[0].id, interval.rows[0].id, membership.rows[0].id],
  );
  const individualSession = await pool.query(
    `INSERT INTO sessions (assignment_id, planned_date)
     VALUES ($1, '2026-10-29') RETURNING id`,
    [individual.rows[0].id],
  );
  await expectReject(
    pool,
    'individual assignment refuses whole-group evaluation',
    `INSERT INTO evaluations
       (session_id, parameter_id, membership_id, locks_at)
     VALUES ($1, $2, NULL, now() + interval '1 day')`,
    [individualSession.rows[0].id, parameter.rows[0].id],
  );
  const wrongMembership = await pool.query(
    `INSERT INTO student_group_members (student_id, group_id, joined_on)
     VALUES ($1, $2, '2026-01-01') RETURNING id`,
    [id, betaGroup.rows[0].id],
  );
  await expectReject(
    pool,
    'task membership must belong to the assignment target',
    `INSERT INTO tasks (session_id, membership_id, title)
     VALUES ($1, $2, 'bad target')`,
    [session.rows[0].id, wrongMembership.rows[0].id],
  );
  const opening = await pool.query(
    `INSERT INTO acct_journal_entries
       (entry_date, memo, source_type, created_by)
     VALUES ('2026-01-01', 'opening probe', 'opening', $1)
     RETURNING id`,
    [staffUser.rows[0].id],
  );
  await expectReject(
    pool,
    'once-ever opening entry unique index',
    `INSERT INTO acct_journal_entries
       (entry_date, memo, source_type, created_by)
     VALUES ('2026-01-01', 'duplicate opening', 'opening', $1)`,
    [staffUser.rows[0].id],
  );
  await pool.query('DELETE FROM acct_journal_entries WHERE id = $1', [opening.rows[0].id]);
  const mapping = await pool.query(`SELECT id, debit_account_id FROM acct_mappings LIMIT 1`);
  await expectReject(
    pool,
    'accounting mapping debit/credit differ CHECK',
    `UPDATE acct_mappings SET credit_account_id = $2 WHERE id = $1`,
    [mapping.rows[0].id, mapping.rows[0].debit_account_id],
  );
  const accountPair = await pool.query(
    `INSERT INTO acct_accounts (code, name, type) VALUES
       ('ZZ-RACE-A', 'Race account A', 'asset'),
       ('ZZ-RACE-B', 'Race account B', 'asset')
     RETURNING id`,
  );
  await pool.query('UPDATE acct_accounts SET parent_id = $2 WHERE id = $1', [
    accountPair.rows[0].id,
    accountPair.rows[1].id,
  ]);
  await expectReject(
    pool,
    'acct_accounts multi-hop cycle trigger',
    'UPDATE acct_accounts SET parent_id = $2 WHERE id = $1',
    [accountPair.rows[1].id, accountPair.rows[0].id],
  );

  const systemEntry = await pool.query(
    `INSERT INTO acct_journal_entries
       (entry_date, memo, source_type, created_by)
     VALUES ('2026-01-01', 'closing probe', 'closing', $1)
     RETURNING id`,
    [staffUser.rows[0].id],
  );
  const lineAccounts = await pool.query(
    `SELECT id FROM acct_accounts WHERE code IN ('1100', '3000') ORDER BY code`,
  );
  await pool.query(
    `INSERT INTO acct_journal_lines (entry_id, account_id, debit, credit) VALUES
       ($1, $2, 1, 0),
       ($1, $3, 0, 1)`,
    [systemEntry.rows[0].id, lineAccounts.rows[0].id, lineAccounts.rows[1].id],
  );
  await pool.query(
    `UPDATE acct_journal_entries SET status = 'posted', posted_by = $2 WHERE id = $1`,
    [systemEntry.rows[0].id, staffUser.rows[0].id],
  );
  await expectReject(
    pool,
    'opening/closing entries cannot be voided',
    `UPDATE acct_journal_entries SET status = 'voided', voided_by = $2 WHERE id = $1`,
    [systemEntry.rows[0].id, staffUser.rows[0].id],
  );

  const duplicateTimestampTriggers = num(
    await pool.query(
      `SELECT count(*)::int AS count
       FROM information_schema.triggers
       WHERE trigger_name IN ('student_groups_set_updated_at', 'parameters_set_updated_at')`,
    ),
  );
  if (duplicateTimestampTriggers === 0) pass('duplicate timestamp triggers removed');
  else fail(`found ${duplicateTimestampTriggers} duplicate timestamp trigger(s)`);
  const prod = await pool.query(
    `INSERT INTO cafe_products (name, price) VALUES ('Tea', 10000) RETURNING id`,
  );
  await pool.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, created_by)
     VALUES ($1, 'adjustment', 5, 5000, $2)`,
    [prod.rows[0].id, staffUser.rows[0].id],
  );
  await pool.query(
    `INSERT INTO voice_transcripts (session_id, role, text)
     VALUES ('reset-probe', 'user', 'erase me')`,
  );
  const removedUsers = await runResetData(pool);
  const afterReset = await resetCounts(pool);
  if (
    removedUsers === 1 &&
    afterReset.users === 1 &&
    afterReset.intervals === 4 &&
    afterReset.voice_transcripts === 0
  ) {
    pass('resetData wiped domain/ledger/transcript rows, removed non-admin user, and re-seeded intervals');
  } else {
    fail(`resetData unexpected state: removed=${removedUsers}, after=${JSON.stringify(afterReset)}`);
  }
}

async function main() {
  const pool = createPglitePool(); // in-memory, fresh
  await pool.ready();
  try {
    await runMigrations(pool);
    await runSanityChecks(pool);

    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    console.log(`\nTables created (${tables.rows.length}):`);
    console.log('  ' + tables.rows.map((r) => r.table_name).join(', '));
  } catch (err) {
    // Migration failures report themselves. Unexpected sanity-check crashes
    // must still fail the command rather than printing a false PASS.
    if (failures === 0) fail(`verification crashed: ${err.message}`);
  } finally {
    await pool.end();
  }

  console.log('');
  if (failures === 0) {
    console.log('RESULT: PASS — all migrations applied and every sanity check passed on PGlite.');
    process.exitCode = 0;
  } else {
    console.log(`RESULT: FAIL — ${failures} check(s) failed. See ✗ lines above.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exitCode = 1;
});
