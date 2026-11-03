// Connected demo fixtures for the modules beyond the evaluation grid. Kept in
// one helper so seedSample.js remains readable and remove can clean the exact
// financial/audit rows transactionally.

import { hashPassword } from '../lib/passwords.js';
import { randomUUID } from 'node:crypto';
import { updateAverageCost } from '../lib/cafeStock.js';
import { applyBalanceChange } from '../lib/cafeBalance.js';
import { createSale, voidSale } from '../lib/cafeSale.js';
import {
  createDraftEntry,
  generateOpeningEntry,
  postEntry,
  postMappedEvent,
} from '../lib/accountingJournal.js';
import { recordAudit } from '../lib/audit.js';

export const SAMPLE_USER_PREFIX = 'sample-';
export const SAMPLE_PASSWORD = 'sample-panel-2026';
const FIELD_PREFIX = 'Sample · ';
const PRODUCT_PREFIX = 'Sample Cafe · ';
const SUPPLIER_PREFIX = 'Sample Supplier · ';
const TASK_PREFIX = 'Sample · ';
const TRANSCRIPT_SESSION = 'sample-kiosk-tour';

const SAMPLE_USERS = [
  ['sample-admin', 'Sample Administrator', 'Administrator'],
  ['sample-staff', 'Sample Staff', 'Staff'],
  ['sample-viewer', 'Sample Viewer', 'Viewer'],
  ['sample-accountant', 'Sample Accountant', 'Accountant'],
  ['sample-kiosk', 'Sample Kiosk', 'Kiosk'],
];

export async function seedSampleUsers(db) {
  const passwordHash = await hashPassword(SAMPLE_PASSWORD);
  const roles = await db.query('SELECT id, name FROM roles');
  const roleByName = new Map(roles.rows.map((row) => [row.name.toLowerCase(), row.id]));
  const users = {};
  for (const [username, fullName, roleName] of SAMPLE_USERS) {
    const roleId = roleByName.get(roleName.toLowerCase());
    if (!roleId) throw new Error(`Sample seed needs the ${roleName} role.`);
    const existing = await db.query('SELECT id FROM users WHERE lower(username) = lower($1)', [username]);
    if (existing.rowCount > 0) {
      await db.query(
        `UPDATE users SET full_name = $2, role_id = $3, password_hash = $4,
                          is_active = true, must_change_password = false
         WHERE id = $1`,
        [existing.rows[0].id, fullName, roleId, passwordHash]
      );
      users[username] = existing.rows[0].id;
    } else {
      const inserted = await db.query(
        `INSERT INTO users
           (username, full_name, role_id, password_hash, must_change_password)
         VALUES ($1, $2, $3, $4, false)
         RETURNING id`,
        [username, fullName, roleId, passwordHash]
      );
      users[username] = inserted.rows[0].id;
    }
  }
  return users;
}

async function seedIdentityAndFields(db, { studentIds, actorId, today }) {
  const definitions = [];
  for (const field of [
    { label: `${FIELD_PREFIX}Guardian phone`, type: 'text', restricted: true, choices: [] },
    { label: `${FIELD_PREFIX}Transport`, type: 'choice', restricted: false, choices: ['Bus', 'Family', 'Walk'] },
    { label: `${FIELD_PREFIX}Needs follow-up`, type: 'yes_no', restricted: false, choices: [] },
  ]) {
    const inserted = await db.query(
      `INSERT INTO student_field_definitions
         (label, field_type, choices, is_restricted, sort_order, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING id`,
      [field.label, field.type, JSON.stringify(field.choices), field.restricted,
        definitions.length * 10 + 10, actorId]
    );
    definitions.push(inserted.rows[0].id);
  }

  const year = Number(today.slice(0, 4));
  for (const [index, studentId] of studentIds.entries()) {
    const birthYear = year - 12 - (index % 5);
    const birthDate = `${birthYear}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 24) + 1).padStart(2, '0')}`;
    const extra = {
      [definitions[0]]: `09${String(100000000 + index).padStart(9, '0')}`,
      [definitions[1]]: ['Bus', 'Family', 'Walk'][index % 3],
      [definitions[2]]: index % 7 === 0,
    };
    await db.query(
      `UPDATE students SET gender = $2::gender_type, birth_date = $3::date,
                           father_name = $4, national_id = $5, extra = $6::jsonb
       WHERE id = $1`,
      [studentId, index % 2 ? 'female' : 'male', birthDate,
        `Sample Parent ${index + 1}`, String(1000000000 + index), JSON.stringify(extra)]
    );
  }
  return definitions.length;
}

async function seedTasksAndAlerts(db, { sessions, parameters, rosters, rosterByAssignment }) {
  if (sessions.length < 3) return { templates: 0, tasks: 0, alerts: 0 };
  const templates = [];
  for (const [index, title] of [
    `${TASK_PREFIX}Warm-up checklist`,
    `${TASK_PREFIX}Accuracy follow-up`,
  ].entries()) {
    const inserted = await db.query(
      `INSERT INTO task_templates
         (title, description, sort_order, parameter_id, extra)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [title, 'Connected sample task template', (index + 1) * 10,
        parameters[index]?.id ?? null, JSON.stringify({ sample: true, difficulty: index + 1 })]
    );
    templates.push(inserted.rows[0].id);
  }

  const member =
    rosterByAssignment?.get(sessions[0].assignmentId)?.[0]?.membershipId ??
    rosters.flat()[0]?.membershipId ??
    null;
  await db.query(
    `INSERT INTO tasks
       (session_id, template_id, title, description, done, done_at,
        sort_order, parameter_id, membership_id, extra)
     VALUES
       ($1, $2, $3, 'Completed sample task', true, now(), 10, $4, $5, '{"sample":true}'),
       ($6, $7, $8, 'Open sample task', false, NULL, 20, $9, NULL, '{"sample":true}')`,
    [sessions[0].id, templates[0], `${TASK_PREFIX}Completed warm-up`, parameters[0]?.id ?? null,
      member, sessions[1].id, templates[1], `${TASK_PREFIX}Review accuracy`, parameters[1]?.id ?? null]
  );
  await db.query(
    `INSERT INTO alerts (kind, session_id, message, resolved_at) VALUES
       ('session_unconfirmed', $1, 'Sample open attendance follow-up', NULL),
       ('session_unconfirmed', $2, 'Sample resolved follow-up', now())`,
    [sessions[0].id, sessions[2].id]
  );
  return { templates: templates.length, tasks: 2, alerts: 2 };
}

async function seedCafeAndAccounting(db, { today, studentIds, actor }) {
  const year = Number(today.slice(0, 4));
  const currentPeriod = await db.query(
    `SELECT id, status FROM acct_fiscal_periods
     WHERE $1::date BETWEEN start_date AND end_date
     ORDER BY start_date DESC LIMIT 1`,
    [today]
  );
  let fiscalPeriodId = currentPeriod.rows[0]?.id;
  if (currentPeriod.rows[0]?.status === 'closed') {
    throw new Error('The fiscal period covering today is closed; reopen it before seeding sample transactions.');
  }
  if (!fiscalPeriodId) {
    fiscalPeriodId = (
      await db.query(
        `INSERT INTO acct_fiscal_periods (name, start_date, end_date)
         VALUES ($1, $2::date, $3::date) RETURNING id`,
        [`Sample FY ${year}`, `${year}-01-01`, `${year}-12-31`]
      )
    ).rows[0].id;
  }
  const previousPeriod = await db.query(
    `SELECT 1 FROM acct_fiscal_periods
     WHERE daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')`,
    [`${year - 1}-01-01`, `${year - 1}-12-31`]
  );
  if (previousPeriod.rowCount === 0) {
    await db.query(
      `INSERT INTO acct_fiscal_periods
         (name, start_date, end_date, status, closed_by, closed_at)
       VALUES ($1, $2::date, $3::date, 'closed', $4, now())`,
      [`Sample FY ${year - 1} (closed)`, `${year - 1}-01-01`, `${year - 1}-12-31`, actor.id]
    );
  }

  const supplierIds = [];
  for (const name of [`${SUPPLIER_PREFIX}Local bakery`, `${SUPPLIER_PREFIX}Drinks distributor`]) {
    supplierIds.push((await db.query(
      `INSERT INTO cafe_suppliers (name, phone, note)
       VALUES ($1, '021-555-0100', 'Connected sample supplier') RETURNING id`, [name]
    )).rows[0].id);
  }
  const productSpecs = [
    ['Water', 12000, 7000],
    ['Fruit juice', 30000, 19000],
    ['Sandwich', 65000, 42000],
    ['Cake', 45000, 28000],
  ];
  const products = [];
  for (const [index, [name, price, cost]] of productSpecs.entries()) {
    const row = (await db.query(
      `INSERT INTO cafe_products (name, price, sort_order, avg_cost)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [`${PRODUCT_PREFIX}${name}`, price, (index + 1) * 10, cost]
    )).rows[0];
    products.push({ id: row.id, price, cost });
  }

  // Pre-accounting stock and balances make the opening snapshot meaningful.
  await db.query(
    `INSERT INTO cafe_stock_movements
       (product_id, kind, qty, unit_cost, note, created_by)
     VALUES ($1, 'adjustment', 8, 0, 'Sample opening stock', $2)`,
    [products[0].id, actor.id]
  );
  await db.query(
    `INSERT INTO student_balances (student_id, balance)
     VALUES ($1, 80000), ($2, -25000)`,
    [studentIds[0], studentIds[1]]
  );
  await db.query(
    `INSERT INTO student_balance_transactions
       (student_id, kind, amount, balance_after, note, created_by)
     VALUES ($1, 'adjustment', 80000, 80000, 'Sample opening credit', $3),
            ($2, 'adjustment', -25000, -25000, 'Sample opening debt', $3)`,
    [studentIds[0], studentIds[1], actor.id]
  );
  const openingExists = await db.query(
    `SELECT 1 FROM acct_journal_entries WHERE source_type = 'opening' LIMIT 1`
  );
  if (openingExists.rowCount === 0) {
    const opening = await generateOpeningEntry(db, { user: actor, date: today });
    if (opening.error) throw new Error(`Could not seed opening entry: ${opening.error}`);
    await recordAudit(db, {
      userId: actor.id, actor: actor.username, action: 'accounting.opening_balance',
      entityType: 'acct_journal_entry', details: { entryNo: opening.entryNo, total: opening.total },
    });
  }

  // A normal purchase exercises purchase lines, stock ledger, moving average,
  // supplier history and automatic accounting in one connected story.
  const purchaseId = (await db.query(
    `INSERT INTO cafe_purchases (supplier_id, note, purchased_at, created_by)
     VALUES ($1, 'Sample replenishment', $2::date, $3) RETURNING id`,
    [supplierIds[0], today, actor.id]
  )).rows[0].id;
  for (const product of products) {
    await db.query(
      `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
       VALUES ($1, $2, 20, $3)`, [purchaseId, product.id, product.cost]
    );
    await db.query(
      `INSERT INTO cafe_stock_movements
         (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
       VALUES ($1, 'purchase', 20, $2, 'purchase', $3, $4)`,
      [product.id, product.cost, purchaseId, actor.id]
    );
  }
  await updateAverageCost(db, purchaseId);
  const purchaseTotal = products.reduce((sum, product) => sum + 20 * product.cost, 0);
  await postMappedEvent(db, {
    user: actor, sourceType: 'cafe_purchase', sourceId: purchaseId, date: today,
    memo: 'Sample cafe purchase', pairs: [{ event: 'cafe.purchase', amount: purchaseTotal }],
  });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'cafe_purchase.create',
    entityType: 'cafe_purchase', details: { purchaseId, supplierId: supplierIds[0], itemCount: 4, total: purchaseTotal },
  });

  await applyBalanceChange(db, {
    studentId: studentIds[2], delta: 120000, kind: 'topup', note: 'Sample top-up', createdBy: actor.id,
  });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'cafe_balance.topup',
    entityType: 'cafe_balance', details: { studentId: studentIds[2], amount: 120000, balanceAfter: 120000 },
  });

  await createSale(db, {
    user: actor, customer: 'walk_in',
    items: [{ productId: products[2].id, qty: 2 }, { productId: products[1].id, qty: 1 }],
    note: 'Sample walk-in sale',
  });
  await createSale(db, {
    user: actor, customer: 'student', studentId: studentIds[2],
    items: [{ productId: products[0].id, qty: 2 }, { productId: products[3].id, qty: 1 }],
    note: 'Sample student sale',
  });
  const voidable = await createSale(db, {
    user: actor, customer: 'walk_in', items: [{ productId: products[1].id, qty: 1 }],
    note: 'Sample voided sale',
  });
  await voidSale(db, { user: actor, saleId: voidable.saleId });

  const wasteId = randomUUID();
  await db.query(
    `INSERT INTO cafe_stock_movements
       (product_id, kind, qty, unit_cost, reference_type, reference_id, note, created_by)
     VALUES ($1, 'waste', -1, $2, 'waste', $3, 'Sample damaged item', $4),
            ($5, 'adjustment', 2, 0, NULL, NULL, 'Sample count correction', $4)`,
    [products[3].id, products[3].cost, wasteId, actor.id, products[0].id]
  );
  await postMappedEvent(db, {
    user: actor, sourceType: 'cafe_waste', sourceId: wasteId, date: today,
    memo: 'Sample cafe waste', pairs: [{ event: 'cafe.waste', amount: products[3].cost }],
  });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'cafe_waste.create',
    entityType: 'cafe_movement', details: { itemCount: 1 },
  });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'cafe_adjustment.create',
    entityType: 'cafe_movement', details: { itemCount: 1 },
  });

  const cash = (await db.query(`SELECT id FROM acct_accounts WHERE code = '1100'`)).rows[0].id;
  const expense = (await db.query(`SELECT id FROM acct_accounts WHERE code = '5500'`)).rows[0].id;
  const postedDraft = await createDraftEntry(db, {
    user: actor, entryDate: today, memo: 'Sample miscellaneous expense',
    lines: [
      { accountId: expense, debit: 15000, credit: 0, memo: null },
      { accountId: cash, debit: 0, credit: 15000, memo: null },
    ],
  });
  await postEntry(db, { user: actor, entryId: postedDraft.entryId });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'accounting_entry.post',
    entityType: 'acct_journal_entry', details: { entryId: postedDraft.entryId, entryNo: postedDraft.entryNo },
  });
  const openDraft = await createDraftEntry(db, {
    user: actor, entryDate: today, memo: 'Sample draft awaiting review',
    lines: [
      { accountId: expense, debit: 7000, credit: 0, memo: null },
      { accountId: cash, debit: 0, credit: 7000, memo: null },
    ],
  });
  await recordAudit(db, {
    userId: actor.id, actor: actor.username, action: 'accounting_entry.draft',
    entityType: 'acct_journal_entry', details: { entryId: openDraft.entryId, entryNo: openDraft.entryNo },
  });

  await db.query(
    `INSERT INTO voice_transcripts (session_id, role, text, meta) VALUES
       ($1, 'user', 'یک آب و یک ساندویچ لطفاً', '{"lang":"fa","sample":true}'),
       ($1, 'agent', 'سبد آماده است؛ ثبت شود؟', '{"lang":"fa","sample":true}'),
       ($1, 'user', 'yes, confirm it', '{"lang":"en","sample":true}'),
       ($1, 'agent', 'Sale recorded.', '{"lang":"en","sample":true}')`,
    [TRANSCRIPT_SESSION]
  );

  return { products: products.length, suppliers: supplierIds.length, fiscalPeriodId, transcripts: 4 };
}

export async function seedConnectedSample(db, context) {
  const actorId = context.users['sample-admin'];
  const actor = { id: actorId, username: 'sample-admin' };
  const fields = await seedIdentityAndFields(db, { ...context, actorId });
  const taskData = await seedTasksAndAlerts(db, context);
  const cafe = await seedCafeAndAccounting(db, { ...context, actor });
  return { fields, ...taskData, ...cafe };
}

export async function removeConnectedSample(db) {
  const users = await db.query(
    `SELECT id FROM users WHERE username LIKE $1`, [`${SAMPLE_USER_PREFIX}%`]
  );
  const userIds = users.rows.map((row) => row.id);
  if (userIds.length === 0) return { users: 0 };

  // All trigger toggles live inside the caller's transaction; any failure rolls
  // them back automatically, so ledger protection can never be left disabled.
  await db.query('ALTER TABLE cafe_stock_movements DISABLE TRIGGER cafe_stock_movements_append_only');
  await db.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_lines_draft_only_trg');
  await db.query('ALTER TABLE acct_journal_lines DISABLE TRIGGER acct_entry_balance_trg');
  await db.query('ALTER TABLE acct_journal_entries DISABLE TRIGGER acct_entry_lifecycle_trg');

  await db.query(
    `DELETE FROM cafe_stock_movements
      WHERE created_by = ANY($1::uuid[])
         OR product_id IN (SELECT id FROM cafe_products WHERE name LIKE $2)`,
    [userIds, `${PRODUCT_PREFIX}%`]
  );
  await db.query(
    `DELETE FROM cafe_sale_items WHERE sale_id IN
       (SELECT id FROM cafe_sales WHERE sold_by = ANY($1::uuid[]))`, [userIds]
  );
  await db.query(`DELETE FROM cafe_sales WHERE sold_by = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM student_balance_transactions WHERE created_by = ANY($1::uuid[])`, [userIds]);
  await db.query(
    `DELETE FROM student_balances WHERE student_id IN
       (SELECT id FROM students WHERE full_name LIKE 'Sample Student%')`
  );
  await db.query(
    `DELETE FROM cafe_purchase_items WHERE purchase_id IN
       (SELECT id FROM cafe_purchases WHERE created_by = ANY($1::uuid[]))`, [userIds]
  );
  await db.query(`DELETE FROM cafe_purchases WHERE created_by = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM cafe_products WHERE name LIKE $1`, [`${PRODUCT_PREFIX}%`]);
  await db.query(`DELETE FROM cafe_suppliers WHERE name LIKE $1`, [`${SUPPLIER_PREFIX}%`]);

  await db.query(
    `DELETE FROM acct_journal_lines WHERE entry_id IN
       (SELECT id FROM acct_journal_entries
        WHERE created_by = ANY($1::uuid[]) OR posted_by = ANY($1::uuid[]))`, [userIds]
  );
  await db.query(
    `DELETE FROM acct_journal_entries
      WHERE created_by = ANY($1::uuid[]) OR posted_by = ANY($1::uuid[])`, [userIds]
  );
  await db.query(`DELETE FROM acct_fiscal_periods WHERE name LIKE 'Sample FY %'`);
  await db.query(`DELETE FROM voice_transcripts WHERE session_id = $1`, [TRANSCRIPT_SESSION]);
  await db.query(`DELETE FROM task_templates WHERE title LIKE $1`, [`${TASK_PREFIX}%`]);
  await db.query(`DELETE FROM student_field_definitions WHERE label LIKE $1`, [`${FIELD_PREFIX}%`]);
  await db.query(`DELETE FROM saved_views WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM user_preferences WHERE user_id = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM user_sessions WHERE (sess->>'userId')::uuid = ANY($1::uuid[])`, [userIds]);
  // Preserve actors referenced by the append-only audit trail.
  await db.query(`UPDATE users SET is_active=false WHERE id = ANY($1::uuid[])`, [userIds]);

  await db.query('ALTER TABLE acct_journal_entries ENABLE TRIGGER acct_entry_lifecycle_trg');
  await db.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_entry_balance_trg');
  await db.query('ALTER TABLE acct_journal_lines ENABLE TRIGGER acct_lines_draft_only_trg');
  await db.query('ALTER TABLE cafe_stock_movements ENABLE TRIGGER cafe_stock_movements_append_only');
  return { users: userIds.length };
}
