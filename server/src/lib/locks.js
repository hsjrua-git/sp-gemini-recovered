import { effectiveEntry } from './evaluationCell.js';

export const NORMAL_LOCK_DAYS = 7;
export const LATE_LOCK_DAYS = 1;
export const MIN_REASON = 5;
export const MAX_REASON = 300;

// The lock window anchors to the SESSION's effective date now (it anchored to
// the write moment in the period model): a session happening this week — or
// still in the future — gets the full 7-day window from its date; an older
// session's rows lock after 1 day. `sessionDate`/`today` are ISO dates.
export function lockDaysFor({ sessionDate, today }) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const day = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / MS_PER_DAY;
  };
  return day(sessionDate) + NORMAL_LOCK_DAYS > day(today)
    ? NORMAL_LOCK_DAYS
    : LATE_LOCK_DAYS;
}

// The timestamp a row's locks_at gets: the session's effective date plus its
// window. Returns an ISO string so pg stores it exactly.
export function locksAtFor({ sessionDate, firstAnsweredAt = null }) {
  if (firstAnsweredAt === null) return null;
  const week = Date.parse(`${sessionDate}T00:00:00Z`) + NORMAL_LOCK_DAYS * 86400000;
  const answer = Date.parse(firstAnsweredAt);
  return new Date(answer < week ? week : answer + LATE_LOCK_DAYS * 86400000).toISOString();
}

// A cell key covers the whole target now: the membership (or the literal
// `group` for the whole-group row) plus the parameter.
export function cellKey(membershipId, parameterId) {
  return `${membershipId ?? 'group'}:${parameterId}`;
}

export function findLockedChanges({ entries, existing, canViewScores = true, patch = false }) {
  const locked = [];
  entries.forEach((entry, index) => {
    const row = existing.get(cellKey(entry.membershipId, entry.parameterId));
    if (!row || !row.isLocked) return;
    // A blind writer must get the same lock response for correct and incorrect
    // guesses. Equality is a no-op exemption only for readers of the scores.
    if (canViewScores) {
      entry = effectiveEntry(entry, row, patch);
      const changed =
        (entry.selected ?? true) !== (row.selected ?? !row.archivedAt) ||
        entry.qualityValue !== row.qualityValue ||
        entry.quantityValue !== row.quantityValue ||
        (entry.qualityComment ?? null) !== (row.qualityComment ?? null) ||
        (entry.quantityComment ?? null) !== (row.quantityComment ?? null);
      if (!changed) return;
    }
    locked.push({
      index,
      membershipId: entry.membershipId,
      parameterId: entry.parameterId,
      lockedAt: row.locksAt,
    });
  });
  return locked;
}

export function parseOverrideReason(input) {
  const message = `Changing locked scores needs a written reason of ${MIN_REASON} to ${MAX_REASON} characters.`;
  if (typeof input !== 'string') return { error: message };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < MIN_REASON || value.length > MAX_REASON) {
    return { error: message };
  }
  return { value };
}
