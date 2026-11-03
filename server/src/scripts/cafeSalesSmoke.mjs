// One-off smoke test for the cafe sale lifecycle (024) against the live
// database, entirely inside a transaction that rolls back. Run with:
//   node --env-file=.env src/scripts/cafeSalesSmoke.mjs
// Exercises lib/cafeSale.js — the same functions the routes call.

import assert from 'node:assert/strict';
import pool from '../db/pool.js';
import { createSale, voidSale } from '../lib/cafeSale.js';
import { applyBalanceChange } from '../lib/cafeBalance.js';
import { todayIso } from '../lib/periods.js';
import { generateStudentCode } from '../lib/studentCode.js';

const client = await pool.connect();

const balanceOf = async (studentId) => {
  const row = await client.query(
    'SELECT COALESCE(balance, 0) AS balance FROM student_balances WHERE student_id = $1',
    [studentId]
  );
  return Number(row.rows[0]?.balance ?? 0);
};

const stockOf = async (productId) => {
  const row = await client.query(
    'SELECT qty::float8 FROM cafe_stock WHERE product_id = $1',
    [productId]
  );
  return row.rows[0].qty;
};

try {
  await client.query('BEGIN');

  const user = (
    await client.query(
      'SELECT id, username FROM users WHERE is_active ORDER BY created_at LIMIT 1'
    )
  ).rows[0];
  const student = (
    await client.query(
      'SELECT id FROM students WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1'
    )
  ).rows[0];
  const startingBalance = await balanceOf(student.id);
  const { getRangeReport } = await import('../lib/cafeReports.js');
  const today = todayIso();
  const baselineReport = await getRangeReport(client, { from: today, to: today });
  const smokeStarted = (await client.query('SELECT now() AS at')).rows[0].at;
  const supplier = (
    await client.query(`INSERT INTO cafe_suppliers (name) VALUES ('ZZSmoke S') RETURNING id`)
  ).rows[0];
  const snack = (
    await client.query(
      `INSERT INTO cafe_products (name, price) VALUES ('ZZSmoke Sandwich', 50000) RETURNING id, price`
    )
  ).rows[0];

  // Stock the product first so cost snapshots are real.
  const pu = await client.query(
    `INSERT INTO cafe_purchases (supplier_id, created_by) VALUES ($1, $2) RETURNING id`,
    [supplier.id, user.id]
  );
  await client.query(
    `INSERT INTO cafe_purchase_items (purchase_id, product_id, qty, unit_cost)
     VALUES ($1, $2, 8, 30000)`,
    [pu.rows[0].id, snack.id]
  );
  await client.query(
    `INSERT INTO cafe_stock_movements (product_id, kind, qty, unit_cost, reference_type, reference_id, created_by)
     VALUES ($1, 'purchase', 8, 30000, 'purchase', $2, $3)`,
    [snack.id, pu.rows[0].id, user.id]
  );
  await client.query('UPDATE cafe_products SET avg_cost = 30000 WHERE id = $1', [snack.id]);

  // 1. A walk-in sale at the default price: totals, cost snapshot, stock out.
  const walkIn = await createSale(client, {
    user,
    customer: 'walk_in',
    items: [{ productId: snack.id, qty: 2 }],
  });
  assert.equal(walkIn.total, 100000, 'walk-in total at the default price');
  assert.equal(walkIn.costTotal, 60000, 'cost snapshot from avg_cost');
  assert.equal(await stockOf(snack.id), 6, 'stock after the walk-in sale');

  // 2. A student sale WITH OVERDRAFT: the balance starts at zero, the charge
  //    is allowed to push it negative, and balance_after reports the debt.
  const studentSale = await createSale(client, {
    user,
    customer: 'student',
    studentId: student.id,
    items: [
      { productId: snack.id, qty: 4 },
      { productId: snack.id, qty: 1, unitPrice: 25000 }, // overridden line
    ],
  });
  // 4 × 50000 + 1 × 25000 = 225000
  assert.equal(studentSale.total, 225000, 'student total with an overridden line');
  assert.equal(studentSale.balanceAfter, startingBalance - 225000, 'overdraft allowed, debt reported');
  assert.equal(await stockOf(snack.id), 1, 'stock after the student sale');
  assert.equal(await balanceOf(student.id), startingBalance - 225000, 'balance row holds the debt');

  // 3. A top-up settles part of the debt; the history replays.
  const afterTopup = await applyBalanceChange(client, {
    studentId: student.id,
    delta: 100000,
    kind: 'topup',
    createdBy: user.id,
  });
  assert.equal(afterTopup, startingBalance - 125000, 'partial settlement');

  // 4. Voiding the student sale refunds the full charge and restores stock.
  const voided = await voidSale(client, { user, saleId: studentSale.saleId });
  assert.equal(voided.balanceAfter, startingBalance + 100000, 'void refunds the charge');
  assert.equal(await stockOf(snack.id), 1 + 5, 'void restores stock');
  const saleRow = await client.query(
    'SELECT voided_at IS NOT NULL AS voided FROM cafe_sales WHERE id = $1',
    [studentSale.saleId]
  );
  assert.equal(saleRow.rows[0].voided, true, 'sale marked voided, not deleted');

  // 5. Voiding twice is refused.
  const second = await voidSale(client, { user, saleId: studentSale.saleId });
  assert.equal(second.error, 'CAFE_SALE_ALREADY_VOIDED', 'double void refused');

  // 6. Archiving at a zero balance cannot be followed by a sale void that
  //    recreates hidden money for the archived student.
  await client.query('SAVEPOINT archived_student_probe');
  const archivalStudent = (
    await client.query(
      `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
       VALUES ($1, 'ZZ Void Archive','female','2000-01-01','Test Father','9876543210') RETURNING id`,
      [generateStudentCode()]
    )
  ).rows[0];
  await client.query(
    `INSERT INTO student_balances (student_id, balance) VALUES ($1, 50000)`,
    [archivalStudent.id]
  );
  const archivalSale = await createSale(client, {
    user,
    customer: 'student',
    studentId: archivalStudent.id,
    items: [{ productId: snack.id, qty: 1 }],
  });
  await client.query('UPDATE students SET deleted_at = now() WHERE id = $1', [
    archivalStudent.id,
  ]);
  const archivedVoid = await voidSale(client, {
    user,
    saleId: archivalSale.saleId,
  });
  assert.equal(
    archivedVoid.error,
    'CAFE_STUDENT_INACTIVE',
    'archived-student void refused'
  );
  assert.equal(await balanceOf(archivalStudent.id), 0, 'archived balance stays settled');
  await client.query('ROLLBACK TO SAVEPOINT archived_student_probe');

  // 7. Values accepted by the per-field bounds must still be refused when
  //    their aggregate cannot be represented exactly by the HTTP number API.
  await client.query('SAVEPOINT precision_probe');
  const expensive = (
    await client.query(
      `INSERT INTO cafe_products (name, price)
       VALUES ('ZZ Precision Probe', 999999999999) RETURNING id`
    )
  ).rows[0];
  await assert.rejects(
    () =>
      createSale(client, {
        user,
        customer: 'walk_in',
        items: [{ productId: expensive.id, qty: 10001 }],
      }),
    (err) => err.code === 'MONEY_OUT_OF_RANGE',
    'unsafe aggregate refused instead of rounded'
  );
  await client.query('ROLLBACK TO SAVEPOINT precision_probe');

  // 8. The balance transaction history replays to the live balance. (Sorted
  //    by amount: inside this smoke all rows share one frozen now(), so
  //    created_at cannot order them; in production it does.)
  const history = await client.query(
    `SELECT amount, balance_after FROM student_balance_transactions
     WHERE student_id = $1 AND created_at >= $2 ORDER BY amount`,
    [student.id, smokeStarted]
  );
  assert.deepEqual(
    history.rows.map((row) => [Number(row.amount), Number(row.balance_after)]).sort((a, b) => a[0] - b[0]),
    [
      [-225000, startingBalance - 225000], // charge
      [100000, startingBalance - 125000], // top-up
      [225000, startingBalance + 100000], // void refund
    ],
    'history replays to the live balance'
  );

  console.log('cafe sales smoke: all 8 checks passed');

  // 9. The range report reads only posted sales: the voided student sale is
  //    excluded, so revenue is the walk-in alone; the student's standing
  //    balance (positive after the refund) counts as no debt.
  const report = await getRangeReport(client, { from: today, to: today });
  assert.equal(report.totals.revenue - baselineReport.totals.revenue, 100000, 'report counts posted sales only');
  assert.equal(report.totals.profit - baselineReport.totals.profit, 100000 - 60000, 'profit = revenue - cost');
  assert.equal(report.debtorCount, baselineReport.debtorCount, 'credited balance adds no debt');
  assert.ok(report.inventoryValue > 0, 'stock is valued');
  console.log('cafe reports smoke: all 5 checks passed');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
