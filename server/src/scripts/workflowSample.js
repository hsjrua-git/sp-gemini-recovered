import { parseChecklist, checklistSnapshot, taskProgress } from '../lib/taskChecklist.js';

// Called inside the complete sample transaction. Parent paths, a student in
// several groups, and independent checklist progress make the workflow visible.
export async function seedWorkflowDetails(db, { groupIds, studentIds }) {
  const root = (await db.query(`INSERT INTO student_groups (name, code) VALUES ('Sample School — مدرسه', 'sample-school') RETURNING id`)).rows[0];
  await db.query('UPDATE student_groups SET parent_id = $1 WHERE id = ANY($2::uuid[])', [root.id, groupIds]);
  const lab = (await db.query(`INSERT INTO student_groups (name, code, parent_id) VALUES ('Sample Lab — کارگاه', 'sample-lab', $1) RETURNING id`, [groupIds[0]])).rows[0];
  await db.query(`INSERT INTO student_group_members (student_id, group_id, joined_on) VALUES ($1, $2, current_date - 365)`, [studentIds[0], lab.id]);
  await db.query(`UPDATE parameters SET parent_id = (SELECT id FROM parameters WHERE code = 'speed') WHERE code IN ('endurance', 'accuracy')`);
  await db.query(`UPDATE parameters SET parent_id = (SELECT id FROM parameters WHERE code = 'teamwork') WHERE code IN ('discipline', 'participation')`);
  const definition = parseChecklist([{ label: 'تمرین گرم‌کردن / Warm-up' }, { label: 'تمرین هدف / Target practice' }, { label: 'بازبینی جلسه / Session review' }]).value;
  const template = (await db.query(`INSERT INTO task_templates (title, description, checklist) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    ['Sample — Checklist follow-up', 'Each assigned checklist has independent progress and notes.', JSON.stringify(definition)])).rows[0];
  const sessions = (await db.query(`SELECT s.id, m.id AS "membershipId" FROM sessions s JOIN assignments a ON a.id = s.assignment_id
    JOIN student_group_members m ON m.group_id = a.group_id AND m.student_id = $1
    WHERE a.code = 'SAMPLE-A1' AND s.session_date < current_date AND s.archived_at IS NULL AND s.canceled_at IS NULL
    ORDER BY s.session_date DESC LIMIT 2`, [studentIds[0]])).rows;
  for (const [index, session] of sessions.entries()) {
    for (const membershipId of [null, session.membershipId]) {
      const task = { checklist: checklistSnapshot(definition), done: false, doneAt: null, note: null };
      const progress = taskProgress(task, index ? { done: true, note: 'Reviewed together — بررسی شد' } : { itemId: definition[0].id, done: true }).value;
      await db.query(`INSERT INTO tasks (session_id, template_id, membership_id, title, checklist, done, done_at, note)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [session.id, template.id, membershipId, 'Sample — Checklist follow-up', JSON.stringify(progress.checklist), progress.done, progress.doneAt, progress.note]);
    }
  }
}
