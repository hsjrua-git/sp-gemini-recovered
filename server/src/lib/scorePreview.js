// Build the per-cell preview for a bulk dry-run.
//
// A cell compares four facts: selected (the row exists), the two values, and
// the two comments. `hasContent` = at least one value or comment.
//
// `canViewScores` gates whether the *existing* cell is revealed. A "blind
// entry" role (scores.enter without scores.view) may type scores but must not
// be able to read them back — see PREREQUISITES in lib/permissions.js. For
// such a user we redact `from` and collapse the status to a neutral 'save' so
// the preview never leaks the current value, nor whether the typed value
// matches it. Locked cells stay flagged (the save path still needs an
// override), but without the timestamp, which would itself hint at state.

import { effectiveEntry, SCORE_FIELDS } from './evaluationCell.js';

function sameCell(a, b) {
  return (
    (a?.selected ?? false) === (b?.selected ?? false) &&
    (a?.qualityValue ?? null) === (b?.qualityValue ?? null) &&
    (a?.quantityValue ?? null) === (b?.quantityValue ?? null) &&
    (a?.qualityComment ?? null) === (b?.qualityComment ?? null) &&
    (a?.quantityComment ?? null) === (b?.quantityComment ?? null)
  );
}

function entryCell(entry) {
  return {
    selected: entry.selected,
    qualityValue: entry.qualityValue ?? null,
    quantityValue: entry.quantityValue ?? null,
    qualityComment: entry.qualityComment ?? null,
    quantityComment: entry.quantityComment ?? null,
  };
}

export function previewCells({
  entries,
  existing,
  problemIndexes,
  canViewScores = true,
  patch = false,
}) {
  const cells = [];

  entries.forEach((entry, index) => {
    if (problemIndexes.has(index)) return;

    const row = existing.get(`${entry.membershipId ?? 'group'}:${entry.parameterId}`);
    const from = row
      ? {
          selected: !row.archivedAt,
          qualityValue: row.qualityValue,
          quantityValue: row.quantityValue,
          qualityComment: row.qualityComment,
          quantityComment: row.quantityComment,
        }
      : null;
    const to = entryCell(effectiveEntry(entry, row, patch));
    const visibleTo = canViewScores || !patch ? to : {
      selected: entry.selected,
      ...Object.fromEntries(SCORE_FIELDS.filter(field => Object.hasOwn(entry, field)).map(field => [field, entry[field]])),
    };

    let status;
    if (canViewScores) {
      if (sameCell(from, to)) status = 'unchanged';
      else if (row?.isLocked) status = 'locked';
      else if (!from) status = 'new';
      else status = 'change';
    } else {
      status = row?.isLocked ? 'locked' : 'save';
    }

    cells.push({
      index,
      membershipId: entry.membershipId,
      parameterId: entry.parameterId,
      status,
      from: canViewScores ? from : null,
      to: visibleTo,
      ...(status === 'locked' && canViewScores ? { lockedAt: row.locksAt } : {}),
    });
  });
  return cells;
}

export function previewCounts(cells, problems) {
  const counts = {
    new: 0,
    change: 0,
    unchanged: 0,
    locked: 0,
    save: 0,
    problems: problems.length,
  };
  for (const cell of cells) counts[cell.status]++;
  return counts;
}
