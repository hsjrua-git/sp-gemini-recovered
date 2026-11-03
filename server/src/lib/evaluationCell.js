export const SCORE_FIELDS = ['qualityValue', 'quantityValue', 'qualityComment', 'quantityComment'];

export function effectiveEntry(entry, row, patch = false) {
  return {
    ...entry,
    ...Object.fromEntries(SCORE_FIELDS.map(field => [field,
      patch && !Object.hasOwn(entry, field) ? row?.[field] ?? null : entry[field] ?? null])),
  };
}

// Unselection retains the row and its original answer/deadline. Restoration
// is a separate update so archived history is never edited in place.
export async function writeEvaluationCell(db, sessionId, entry, row) {
  if (!entry.selected) {
    if (!row || row.archivedAt) return { rowCount: 0 };
    return db.query('UPDATE evaluations SET archived_at=now() WHERE id=$1', [row.id]);
  }
  if (row?.archivedAt) {
    await db.query('UPDATE evaluations SET archived_at=NULL WHERE id=$1', [row.id]);
  }
  const result = await db.query(
    `INSERT INTO evaluations (session_id,parameter_id,membership_id,
       quality_value,quantity_value,quality_comment,quantity_comment)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (session_id,parameter_id,membership_id) DO UPDATE SET
       quality_value=EXCLUDED.quality_value, quantity_value=EXCLUDED.quantity_value,
       quality_comment=EXCLUDED.quality_comment, quantity_comment=EXCLUDED.quantity_comment
     WHERE evaluations.quality_value IS DISTINCT FROM EXCLUDED.quality_value
        OR evaluations.quantity_value IS DISTINCT FROM EXCLUDED.quantity_value
        OR evaluations.quality_comment IS DISTINCT FROM EXCLUDED.quality_comment
        OR evaluations.quantity_comment IS DISTINCT FROM EXCLUDED.quantity_comment`,
    [sessionId, entry.parameterId, entry.membershipId, ...SCORE_FIELDS.map(field => entry[field])],
  );
  return { rowCount: row?.archivedAt ? 1 : result.rowCount };
}
