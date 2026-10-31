// Operational home scope is the database's local day, shared with cafe reports.
// session_status delegates completion to the established selected-cell rules:
// no cross-product of every student and every parameter is invented here.
export async function homeOverview(db) {
  const result = await db.query(`
    WITH eligible AS MATERIALIZED (
      SELECT s.id, s.assignment_id AS "assignmentId", s.session_date AS day,
             s.session_date::text AS "sessionDate", s.code,
             a.name AS "assignmentName", t.full_name AS "teacherName",
             COALESCE(g.name, st.full_name) AS "targetName",
             CASE WHEN ss.status = 'complete' THEN 'complete'
                  WHEN ss.status = 'partial' THEN 'partial'
                  ELSE 'notStarted' END AS status
      FROM sessions s
      JOIN session_status ss ON ss.session_id = s.id
      JOIN assignments a ON a.id = s.assignment_id AND a.archived_at IS NULL
      JOIN teachers t ON t.id = a.teacher_id
      LEFT JOIN student_groups g ON g.id = a.group_id
      LEFT JOIN student_group_members m ON m.id = a.membership_id
      LEFT JOIN students st ON st.id = m.student_id
      WHERE s.canceled_at IS NULL AND s.archived_at IS NULL
        AND s.session_date <= CURRENT_DATE
    ), today_rows AS (
      SELECT * FROM eligible WHERE day = CURRENT_DATE ORDER BY code, id LIMIT 8
    ), queue_rows AS (
      SELECT * FROM eligible WHERE status <> 'complete' ORDER BY day, code, id LIMIT 8
    )
    SELECT CURRENT_DATE::text AS today, current_setting('TimeZone') AS "timeZone",
      (SELECT count(*)::int FROM students WHERE deleted_at IS NULL) AS "studentCount",
      (SELECT count(*)::int FROM eligible WHERE day = CURRENT_DATE) AS "classCount",
      (SELECT count(*)::int FROM eligible WHERE status <> 'complete') AS "gradingCount",
      (SELECT count(*)::int FROM eligible WHERE status = 'notStarted') AS "notStartedCount",
      (SELECT count(*)::int FROM eligible WHERE status = 'partial') AS "partialCount",
      COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'day' ORDER BY r.code, r.id) FROM today_rows r), '[]'::jsonb) AS classes,
      COALESCE((SELECT jsonb_agg(to_jsonb(r) - 'day' ORDER BY r.day, r.code, r.id) FROM queue_rows r), '[]'::jsonb) AS grading
  `);
  return result.rows[0];
}
