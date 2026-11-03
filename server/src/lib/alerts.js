// Schema-4 incomplete-session alerts. Call this with a checked-out client
// inside a transaction: the transaction-scoped advisory locks are shared with
// the evaluation trigger, so completion cannot race an alert insert.

export async function scanAlerts(db) {
  await db.query('SELECT lock_academic_write()');
  const candidates = await db.query(`
    SELECT s.id
    FROM sessions s
    WHERE s.archived_at IS NULL
      AND s.canceled_at IS NULL
      AND s.session_date + interval '1 day' < localtimestamp
      AND NOT session_is_complete(s.id)
    ORDER BY s.id
  `);

  let raised = 0;
  for (const { id } of candidates.rows) {
    await db.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`,
      [id]
    );
    const inserted = await db.query(
      `INSERT INTO alerts (kind, session_id, message)
       SELECT 'session_unconfirmed', s.id,
              'Session ' || s.code
              || ' on ' || to_char(s.session_date, 'YYYY-MM-DD')
              || ' is missing required evaluation answers.'
       FROM sessions s
       WHERE s.id = $1
         AND s.archived_at IS NULL
         AND s.canceled_at IS NULL
         AND s.session_date + interval '1 day' < localtimestamp
         AND NOT session_is_complete(s.id)
       ON CONFLICT DO NOTHING`,
      [id]
    );
    raised += inserted.rowCount;
  }

  const openSessions = await db.query(`
    SELECT DISTINCT session_id AS id
    FROM alerts
    WHERE kind = 'session_unconfirmed'
      AND resolved_at IS NULL
      AND session_id IS NOT NULL
    ORDER BY session_id
  `);

  let resolved = 0;
  for (const { id } of openSessions.rows) {
    const result = await db.query(
      `SELECT resolve_session_alerts($1)::int AS resolved`,
      [id]
    );
    resolved += result.rows[0].resolved;
  }

  return { raised, resolved };
}

export function startAlertScanner(pool, { intervalMs = 60_000, onError = console.error } = {}) {
  let pending = null;
  const run = () => {
    if (pending) return;
    pending = (async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await scanAlerts(client);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    })().catch(onError).finally(() => { pending = null; });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref();
  run();
  return async () => { clearInterval(timer); await pending; };
}
