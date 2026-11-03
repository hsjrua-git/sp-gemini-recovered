// The assignment-period results grid (schema-4 model). Rows are the
// assignment's evaluation targets — the whole-group row first, then its
// members (or the single member of an individual assignment) — and columns
// are parameters. Each cell carries BOTH dimensions plus its answered state;
// `previous` holds the selected dimension's value from the assignment's
// previous period (seq − 1) for the change columns.
//
// Pure so it can be unit tested without a database; the route owns the SQL
// and resolves which sessions belong to the requested (and previous) bucket.
// Evaluations arrive in session order, with ISO sessionDate; targets carry ISO
// addedOn/leftOn bounds so group fallback respects historical membership.

function mergeCell(existing, incoming) {
  const qualityCount = (existing?.qualityCount ?? 0) + (incoming.quality != null ? 1 : 0);
  const quantityCount = (existing?.quantityCount ?? 0) + (incoming.quantity != null ? 1 : 0);
  const qualitySum = (existing?.qualitySum ?? 0) + (incoming.quality ?? 0);
  const quantitySum = (existing?.quantitySum ?? 0) + (incoming.quantity ?? 0);
  return {
    quality: qualityCount ? Math.round(qualitySum / qualityCount * 100) / 100 : null,
    quantity: quantityCount ? Math.round(quantitySum / quantityCount * 100) / 100 : null,
    qualitySum, quantitySum, qualityCount, quantityCount,
    qualityComment: incoming.qualityComment ?? existing?.qualityComment ?? null,
    quantityComment: incoming.quantityComment ?? existing?.quantityComment ?? null,
    answered: Boolean(existing?.answered || incoming.answered),
  };
}

export function buildResults({
  seq,
  period,
  assignment,
  parameters,
  targets,
  groupName,
  evaluations,
}) {
  const cellMap = new Map();
  const previousMap = new Map();
  const ownCells = new Set(evaluations
    .filter((item) => item.membershipId !== null)
    .map((item) => `${item.sessionId}:${item.membershipId}:${item.parameterId}`));

  for (const item of evaluations) {
    const map = item.periodSeq === seq ? cellMap
      : item.periodSeq === seq - 1 ? previousMap : null;
    if (!map) continue;
    const cell = {
      quality: item.qualityValue ?? null,
      quantity: item.quantityValue ?? null,
      qualityComment: item.qualityComment ?? null,
      quantityComment: item.quantityComment ?? null,
      answered:
        item.qualityValue != null ||
        item.quantityValue != null ||
        item.qualityComment != null ||
        item.quantityComment != null,
    };
    const add = (membershipId) => {
      const key = `${membershipId ?? 'group'}:${item.parameterId}`;
      map.set(key, mergeCell(map.get(key), cell));
    };
    add(item.membershipId);
    if (assignment.groupId && item.membershipId === null) {
      for (const target of targets) {
        // An own row shadows the WHOLE group cell for this session, even when
        // empty. Resolve that before merging across sessions in the period.
        if (target.addedOn <= item.sessionDate &&
            (!target.leftOn || target.leftOn >= item.sessionDate) &&
            !ownCells.has(`${item.sessionId}:${target.membershipId}:${item.parameterId}`)) {
          add(target.membershipId);
        }
      }
    }
  }

  // The whole-group row leads a group assignment's grid; an individual
  // assignment has exactly its member.
  const rows = [];
  if (assignment.groupId) {
    rows.push({
      membershipId: null,
      studentId: null,
      fullName: groupName,
      studentCode: null,
      isGroup: true,
      cells: pickCells(null, cellMap, parameters),
      previous: pickPrevious(null, previousMap, parameters),
    });
  }
  for (const target of targets) {
    rows.push({
      membershipId: target.membershipId,
      studentId: target.studentId,
      fullName: target.fullName,
      studentCode: target.studentCode,
      isGroup: false,
      cells: pickCells(target.membershipId, cellMap, parameters),
      previous: pickPrevious(target.membershipId, previousMap, parameters),
    });
  }

  return { rows };
}

function pickCells(membershipId, cellMap, parameters) {
  const cells = {};
  for (const parameter of parameters) {
    const cell = cellMap.get(`${membershipId ?? 'group'}:${parameter.id}`);
    if (cell) {
      cells[parameter.id] = {
        quality: cell.quality, quantity: cell.quantity,
        qualityComment: cell.qualityComment, quantityComment: cell.quantityComment,
        answered: cell.answered,
      };
    }
  }
  return cells;
}

function pickPrevious(membershipId, previousMap, parameters) {
  const previous = {};
  for (const parameter of parameters) {
    const cell = previousMap.get(`${membershipId ?? 'group'}:${parameter.id}`);
    if (!cell) continue;
    // `previous` keeps the per-dimension values; the client picks the column.
    previous[parameter.id] = {
      quality: cell.quality,
      quantity: cell.quantity,
    };
  }
  return previous;
}
