import { buildResults } from './results.js';

// One repeatable snapshot and a bounded number of queries for every selected
// period. The browser never has to fan out hundreds of assignment requests.
export async function readReportResults(db, periodIds, { from = null, to = null } = {}) {
  const periods = (await db.query(
    `SELECT ps.period_id AS id, ps.assignment_id AS "assignmentId", ps.seq,
            ps.started_on::text AS "startDate", ps.ended_on::text AS "endDate",
            a.code, a.name, a.group_id AS "groupId", g.name AS "groupName",
            a.membership_id AS "assignmentMembershipId", t.full_name AS "teacherName"
     FROM period_summary ps JOIN assignments a ON a.id = ps.assignment_id
     JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE ps.period_id = ANY($1::uuid[]) AND ps.sessions_count > 0
     ORDER BY ps.started_on, a.code, ps.seq`, [periodIds]
  )).rows;
  const relevant = (await db.query(
    `SELECT DISTINCT p.id FROM periods p JOIN periods selected
       ON p.assignment_id = selected.assignment_id AND p.seq IN (selected.seq, selected.seq - 1)
     WHERE selected.id = ANY($1::uuid[]) AND p.archived_at IS NULL`, [periodIds]
  )).rows.map(row => row.id);
  const parameters = (await db.query(
    `SELECT id, code, name, parent_id AS "parentId", sort_order AS "sortOrder",
            min_value AS "minValue", max_value AS "maxValue"
     FROM parameters WHERE archived_at IS NULL ORDER BY sort_order, lower(name)`
  )).rows;
  const targets = (await db.query(
    `SELECT DISTINCT a.id AS "assignmentId", p.seq AS "periodSeq", ms.id AS "membershipId",
            st.id AS "studentId", st.full_name AS "fullName", st.student_code AS "studentCode",
            ms.joined_on::text AS "addedOn", ms.left_on::text AS "leftOn"
     FROM sessions s JOIN periods p ON p.id = s.period_id
     JOIN assignments a ON a.id = s.assignment_id
     JOIN student_group_members ms ON (a.group_id IS NOT NULL AND ms.group_id = a.group_id)
                                  OR ms.id = a.membership_id
     JOIN students st ON st.id = ms.student_id
     WHERE p.id = ANY($1::uuid[]) AND s.archived_at IS NULL AND s.canceled_at IS NULL
       AND st.deleted_at IS NULL AND ms.joined_on <= s.session_date
       AND (ms.left_on IS NULL OR ms.left_on >= s.session_date)
       AND ($2::date IS NULL OR s.session_date >= $2) AND ($3::date IS NULL OR s.session_date <= $3)
     ORDER BY st.full_name`, [relevant, from, to]
  )).rows;
  const evaluations = (await db.query(
    `SELECT s.assignment_id AS "assignmentId", e.session_id AS "sessionId",
            s.session_date::text AS "sessionDate", e.membership_id AS "membershipId",
            e.parameter_id AS "parameterId", e.quality_value AS "qualityValue",
            e.quantity_value AS "quantityValue", e.quality_comment AS "qualityComment",
            e.quantity_comment AS "quantityComment", p.seq AS "periodSeq"
     FROM evaluations e JOIN sessions s ON s.id = e.session_id JOIN periods p ON p.id = s.period_id
     WHERE p.id = ANY($1::uuid[]) AND s.archived_at IS NULL AND s.canceled_at IS NULL
       AND e.archived_at IS NULL
       AND ($2::date IS NULL OR s.session_date >= $2) AND ($3::date IS NULL OR s.session_date <= $3)
     ORDER BY s.session_date, s.seq`, [relevant, from, to]
  )).rows;
  return { parameters, grids: periods.map(period => {
    const assignment = { id: period.assignmentId, code: period.code, name: period.name,
      groupId: period.groupId, teacherName: period.teacherName };
    const roster = targets.filter(row => row.assignmentId === period.assignmentId && row.periodSeq === period.seq);
    const history = evaluations.filter(row => row.assignmentId === period.assignmentId && [period.seq, period.seq - 1].includes(row.periodSeq));
    return { assignment, period: { id: period.id, seq: period.seq, startDate: period.startDate, endDate: period.endDate },
      ...buildResults({ seq: period.seq, assignment, parameters, targets: roster,
        groupName: period.groupName, evaluations: history }),
      hasPrevious: history.some(row => row.periodSeq === period.seq - 1) };
  }) };
}
