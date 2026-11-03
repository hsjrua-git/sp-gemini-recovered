import pg from 'pg';
import { attachAuditContext } from '../lib/auditContext.js';

// Return PostgreSQL `date` columns (OID 1082) as raw 'YYYY-MM-DD' strings
// rather than local-midnight JS Date objects, preventing UTC timezone shifts
// in JSON responses and lexicographical string comparisons on Date.toString().
pg.types.setTypeParser(1082, (value) => value);

// A small, bounded pool is plenty for a single-process LAN app, and the ceiling
// protects PostgreSQL from ever seeing a runaway number of connections. The
// timeouts make failures fast and loud instead of hanging a request forever:
//   - connectionTimeoutMillis: give up acquiring a connection after 10s.
//   - idleTimeoutMillis: release connections idle for 30s back to Postgres.
//   - statement_timeout: let Postgres cancel any single query that runs > 15s,
//     so a pathological query can't pin a connection indefinitely.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});

// A pool-level error (e.g. Postgres dropped an idle connection) would otherwise
// crash the process as an unhandled 'error' event. Log it and let the pool
// recover on the next acquire.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

export default attachAuditContext(pool);
