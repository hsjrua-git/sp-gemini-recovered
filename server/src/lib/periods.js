// Schema-4 periods are persisted per assignment. A session joins a period only
// after its first answer; database triggers detach it when no active answer
// remains or the session becomes inactive. This module only validates calendar
// dates and reads that authoritative membership.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dayNumber(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / MS_PER_DAY;
}

function isoDateFromDayNumber(days) {
  return new Date(days * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isValidIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  return text.slice(0, 4) !== '0000' && isoDateFromDayNumber(dayNumber(text)) === text;
}

export function todayIso(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Active periods for one assignment. Membership and date spans come from the
// database-maintained period_summary view. `answeredCount` is score-derived,
// so the HTTP route strips it for callers without scores.view.
export async function listAssignmentPeriods(db, assignmentId = null) {
  const result = await db.query(
    `WITH answered AS (
       SELECT s.period_id, count(e.id)::int AS answered
       FROM sessions s
       JOIN evaluations e
         ON e.session_id = s.id
        AND e.archived_at IS NULL
        AND evaluation_is_answered(
          e.quality_value,
          e.quantity_value,
          e.quality_comment,
          e.quantity_comment
        )
       WHERE ($1::uuid IS NULL OR s.assignment_id = $1)
         AND s.period_id IS NOT NULL
         AND s.canceled_at IS NULL
         AND s.archived_at IS NULL
       GROUP BY s.period_id
     )
      SELECT ps.period_id AS id,
             ps.assignment_id AS "assignmentId",
             assignment.code AS "assignmentCode",
            ps.seq,
            NULL::timestamptz AS "archivedAt",
            ps.sessions_count::int AS "sessionCount",
            ps.is_complete AS "isComplete",
            ps.started_on::text AS "startDate",
            ps.ended_on::text AS "endDate",
            COALESCE(a.answered, 0) AS "answeredCount"
      FROM period_summary ps
      JOIN assignments assignment ON assignment.id=ps.assignment_id
     LEFT JOIN answered a ON a.period_id = ps.period_id
      WHERE ($1::uuid IS NULL OR ps.assignment_id = $1)
      ORDER BY ps.assignment_id, ps.seq`,
    [assignmentId]
  );
  return result.rows;
}
