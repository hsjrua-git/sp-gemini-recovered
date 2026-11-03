import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resets the database to a "fresh institution" state:
//   KEEPS  roles + role_permissions (the seeded system roles), every user
//          holding the Administrator role (so you can still sign in), except
//          development-only `sample-*` accounts; the
//          stored secrets (`secrets`), and the system chart of accounts +
//          default cafe-to-journal mappings (re-seeded if customized).
//          Migrations (schema_migrations) are untouched.
//   WIPES  all students, groups and memberships, evaluations, parameters,
//          custom-field definitions, the whole schedule (intervals, teachers,
//          assignments, sessions, periods, tasks, task templates, alerts —
//          then re-seeds the 4 default intervals from migration 018), all
//          cafe activity and catalog (sales, balances, purchases, stock
//          movements, products, suppliers), all accounting journal entries
//          and fiscal periods, voice transcripts, the audit log, saved views, personal
//          preferences, login sessions, and every non-admin account.
//
// Guarded: `npm run reset-data -- confirm` actually wipes. Without "confirm"
// it prints the current rows and what it would do, then exits (a dry run).

function fail(message) {
  console.error(message);
  process.exit(1);
}

export async function counts(db) {
  const { rows } = await db.query(`SELECT
    (SELECT count(*)::int FROM students)                  AS students,
    (SELECT count(*)::int FROM evaluations)               AS evaluations,
    (SELECT count(*)::int FROM parameters)                AS parameters,
    (SELECT count(*)::int FROM student_groups)            AS groups,
    (SELECT count(*)::int FROM student_field_definitions) AS field_defs,
    (SELECT count(*)::int FROM teachers)                  AS teachers,
    (SELECT count(*)::int FROM intervals)                 AS intervals,
    (SELECT count(*)::int FROM assignments)               AS assignments,
    (SELECT count(*)::int FROM sessions)                  AS schedule_sessions,
    (SELECT count(*)::int FROM periods)                   AS periods,
    (SELECT count(*)::int FROM tasks)                     AS tasks,
    (SELECT count(*)::int FROM alerts)                    AS alerts,
    (SELECT count(*)::int FROM cafe_products)             AS cafe_products,
    (SELECT count(*)::int FROM cafe_sales)                AS cafe_sales,
    (SELECT count(*)::int FROM acct_journal_entries)      AS journal_entries,
    (SELECT count(*)::int FROM acct_fiscal_periods)       AS fiscal_periods,
    (SELECT count(*)::int FROM audit_log)                 AS audit,
    (SELECT count(*)::int FROM saved_views)               AS saved_views,
    (SELECT count(*)::int FROM user_preferences)          AS preferences,
    (SELECT count(*)::int FROM user_sessions)             AS login_sessions,
    (SELECT count(*)::int FROM voice_transcripts)         AS voice_transcripts,
    (SELECT count(*)::int FROM users)                     AS users`);
  return rows[0];
}

export async function reset(db) {
  // Safety net: refuse if it would leave no active admin to sign in with.
  const keep = await db.query(
    `SELECT count(*)::int AS n FROM users
     WHERE role_id IN (SELECT id FROM roles WHERE lower(name) = 'administrator')
        AND is_active
        AND username NOT LIKE 'sample-%'`
  );
  if (keep.rows[0].n === 0) {
    throw new Error('Refusing to reset: no active Administrator user would remain to sign in.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Take the academic gate before TRUNCATE's table locks, matching the
    // background scanner and every transactional academic writer.
    if ((await client.query("SELECT to_regprocedure('lock_academic_write()') AS gate")).rows[0].gate) {
      await client.query('SELECT lock_academic_write()');
    }
    await client.query("SELECT set_config('app.reset_data', 'on', true)");

    // Content + structure + cafe + accounting runtime ledgers. Truncating cafe
    // purchases/movements/sales/balances and accounting journals/periods before
    // deleting non-admin users ensures no FK references block user deletion
    // and keeps stock/ledger state consistent.
    await client.query(`TRUNCATE
      evaluations,
      tasks, task_templates, alerts,
      sessions, periods, assignments, teachers, intervals,
      parameters, student_field_definitions,
      student_group_members, student_groups, students,
      cafe_sale_items, cafe_sales,
      student_balance_transactions, student_balances,
      cafe_purchase_items, cafe_purchases, cafe_stock_movements,
      cafe_products, cafe_suppliers,
      acct_journal_lines, acct_journal_entries, acct_fiscal_periods
      RESTART IDENTITY CASCADE`);

    await client.query('TRUNCATE voice_transcripts');

    await client.query(`ALTER SEQUENCE acct_entry_no_seq RESTART WITH 1000`);

    // Re-seed the 4 default scheduling intervals from migration 018.
    await client.query(`
      INSERT INTO intervals (name, every, sort_order) VALUES
        ('Every 3 days',  '3 days',   30),
        ('Weekly',        '7 days',   10),
        ('Every 2 weeks', '14 days',  20),
        ('Monthly',       '1 month',  40)
    `);

    // Restore system chart of accounts and default cafe->journal mappings (026),
    // and remove any custom non-system accounts.
    await client.query(`DELETE FROM acct_mappings`);
    await client.query(`DELETE FROM acct_accounts WHERE NOT is_system`);
    await client.query(`UPDATE acct_accounts SET is_active = true, parent_id = NULL WHERE is_system`);
    await client.query(`
      INSERT INTO acct_mappings (event, debit_account_id, credit_account_id)
      SELECT v.event,
             (SELECT id FROM acct_accounts WHERE code = v.dr),
             (SELECT id FROM acct_accounts WHERE code = v.cr)
      FROM (VALUES
        ('cafe.sale_walk_in', '1100', '4100'),
        ('cafe.sale_student', '2100', '4100'),
        ('cafe.cogs',         '5100', '1200'),
        ('cafe.purchase',     '1200', '1100'),
        ('cafe.waste',        '5500', '1200'),
        ('balance.topup',     '1100', '2100'),
        ('balance.refund',    '2100', '1100')
      ) AS v(event, dr, cr)
    `);

    // History + personal data. Removing the log first means no rows reference
    // the users we are about to delete.
    await client.query('TRUNCATE audit_log RESTART IDENTITY');
    await client.query('DELETE FROM saved_views');
    await client.query('DELETE FROM user_preferences');
    if ((await client.query("SELECT to_regclass('public.preferences') AS table_name")).rows[0].table_name) {
      await client.query("UPDATE preferences SET settings = '{}'::jsonb WHERE id = 1");
      await client.query('DELETE FROM settings');
    }

    // Every account except real Administrator(s). The known-password sample
    // fixtures must never survive a reset into an otherwise production-like DB.
    const removed = await client.query(
      `DELETE FROM users
       WHERE role_id NOT IN (SELECT id FROM roles WHERE lower(name) = 'administrator')
          OR username LIKE 'sample-%'`
    );

    // Log everyone out (server-side session store).
    await client.query('TRUNCATE user_sessions');

    await client.query('COMMIT');
    return removed.rowCount;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { default: pool } = await import('../db/pool.js');
  const command = process.argv[2];
  console.log('Current rows:', await counts(pool));

  if (command === 'confirm') {
    try {
      const removedCount = await reset(pool);
      console.log(`Removed ${removedCount} non-admin user(s).`);
      console.log('After reset:', await counts(pool));
      console.log('Done — fresh-institution state: system roles, seeded intervals/chart, and your admin only.');
    } catch (err) {
      fail(err.message);
    }
  } else if (command === undefined) {
    console.log(
      '\nDry run — nothing was changed.\n' +
        'This WIPES students, groups and memberships, evaluations, parameters, the\n' +
        'whole schedule (re-seeding the 4 default intervals), cafe sales/stock/balances\n' +
        'and catalog, accounting journal entries and fiscal periods (restoring the\n' +
        'system chart of accounts and mappings), voice transcripts, field definitions, the audit log,\n' +
        'saved views, preferences, and login sessions, and removes every non-admin account.\n' +
        'Roles, permissions, stored secrets, and your Administrator account stay.\n\n' +
        'To actually do it:  npm run reset-data -- confirm'
    );
  } else {
    fail(
      'Usage:\n  npm run reset-data            dry run (shows what would be wiped)\n  npm run reset-data -- confirm wipes to a fresh-institution state'
    );
  }

  await pool.end();
}
