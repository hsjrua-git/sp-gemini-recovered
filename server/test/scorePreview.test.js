// Tests for the schema-4 bulk preview: a cell compares `selected` plus two
// value/comment dimensions against the existing evaluation row, and a
// blind-entry role (scores.enter without scores.view) gets a redacted
// preview that never reveals what is already stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewCells, previewCounts } from '../src/lib/scorePreview.js';

const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';
const SPEED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const lockedAt = '2026-03-17T00:00:00.000Z';
const existing = new Map([
  [
    `${M1}:${SPEED}`,
    {
      selected: true,
      qualityValue: 7,
      quantityValue: null,
      qualityComment: null,
      quantityComment: null,
      isLocked: false,
      locksAt: lockedAt,
    },
  ],
  [
    `${M2}:${SPEED}`,
    {
      selected: true,
      qualityValue: 5,
      quantityValue: 2,
      qualityComment: 'steady',
      quantityComment: null,
      isLocked: true,
      locksAt: lockedAt,
    },
  ],
  [
    `group:${OPEN}`,
    {
      selected: true,
      qualityValue: 9,
      quantityValue: null,
      qualityComment: null,
      quantityComment: null,
      isLocked: false,
      locksAt: lockedAt,
    },
  ],
]);

const entry = (membershipId, parameterId, overrides = {}) => ({
  membershipId,
  parameterId,
  selected: true,
  qualityValue: null,
  quantityValue: null,
  qualityComment: null,
  quantityComment: null,
  ...overrides,
});

const preview = (entries, problemIndexes = new Set()) =>
  previewCells({ entries, existing, problemIndexes });

test('partial imports preserve omitted fields without echoing hidden scores to blind writers', () => {
  const entries = [{ membershipId: M2, parameterId: SPEED, selected: true, quantityValue: 4 }];
  const reader = previewCells({ entries, existing, patch: true, problemIndexes: new Set() })[0];
  assert.equal(reader.to.qualityValue, 5);
  assert.equal(reader.to.qualityComment, 'steady');
  assert.equal(reader.to.quantityValue, 4);
  const blind = previewCells({ entries, existing, patch: true, canViewScores: false, problemIndexes: new Set() })[0];
  assert.equal(blind.from, null);
  assert.deepEqual(blind.to, { selected: true, quantityValue: 4 });
  assert.equal(blind.lockedAt, undefined);
});

test('a new cell has no `from`', () => {
  const cells = preview([entry(M1, OPEN, { qualityValue: 4 })]);
  assert.equal(cells[0].status, 'new');
  assert.equal(cells[0].from, null);
  assert.deepEqual(cells[0].to, {
    selected: true,
    qualityValue: 4,
    quantityValue: null,
    qualityComment: null,
    quantityComment: null,
  });
});

test('a changed cell reports from and to for every dimension', () => {
  // `to` echoes exactly what was typed — it does not merge with the row.
  const cells = preview([
    entry(M1, SPEED, { qualityValue: 7, quantityValue: 3, qualityComment: 'brave' }),
  ]);
  assert.equal(cells[0].status, 'change');
  assert.deepEqual(cells[0].from, {
    selected: true,
    qualityValue: 7,
    quantityValue: null,
    qualityComment: null,
    quantityComment: null,
  });
  assert.deepEqual(cells[0].to, {
    selected: true,
    qualityValue: 7,
    quantityValue: 3,
    qualityComment: 'brave',
    quantityComment: null,
  });
});

test('an unchanged cell matches on all five facts, missing comments included', () => {
  const cells = preview([
    entry(M1, SPEED, { qualityValue: 7 }),
    // A bare entry without comment keys still matches null comments.
    {
      membershipId: M1,
      parameterId: SPEED,
      selected: true,
      qualityValue: 7,
      quantityValue: null,
    },
  ]);
  assert.deepEqual(
    cells.map((c) => c.status),
    ['unchanged', 'unchanged']
  );
});

test('selection-only and comment-only changes count as changes', () => {
  const cells = preview([
    entry(M1, SPEED, { qualityValue: 7 }), // identical → unchanged
    entry(M1, SPEED, { qualityValue: 7, selected: false }), // removing the row
    entry(M1, SPEED, { qualityValue: 7, qualityComment: 'ok' }), // comment-only
  ]);
  assert.deepEqual(
    cells.map((c) => c.status),
    ['unchanged', 'change', 'change']
  );
  assert.equal(cells[1].to.selected, false);
});

test('removing a cell that does not exist changes nothing', () => {
  const cells = preview([entry(M1, OPEN, { selected: false })]);
  assert.equal(cells[0].status, 'unchanged');
});

test('a locked cell is flagged only when it actually changed', () => {
  const cells = preview([
    entry(M2, SPEED, { qualityValue: 5, quantityValue: 2, qualityComment: 'steady' }),
    entry(M2, SPEED, { qualityValue: 6 }),
  ]);
  assert.deepEqual(
    cells.map((c) => c.status),
    ['unchanged', 'locked'] // unchanged beats locked
  );
  assert.equal(cells[1].lockedAt, lockedAt);
  assert.ok(!('lockedAt' in cells[0]));
});

test('the whole-group row resolves through the group key', () => {
  const cells = preview([
    entry(null, OPEN, { qualityValue: 9 }),
    entry(null, OPEN, { qualityValue: 8 }),
  ]);
  assert.deepEqual(
    cells.map((c) => c.status),
    ['unchanged', 'change']
  );
  assert.deepEqual(cells[0].from, {
    selected: true,
    qualityValue: 9,
    quantityValue: null,
    qualityComment: null,
    quantityComment: null,
  });
});

test('cells with problems are left out of the preview', () => {
  const cells = preview(
    [entry(M1, SPEED, { qualityValue: 8 }), entry(M1, OPEN, { qualityValue: 1 })],
    new Set([0])
  );
  assert.deepEqual(
    cells.map((c) => [c.index, c.status]),
    [[1, 'new']]
  );
});

test('a blind-entry preview redacts the existing cell and never hints at it', () => {
  // scores.enter without scores.view: canViewScores is false.
  const cells = previewCells({
    entries: [
      entry(M1, SPEED, { qualityValue: 8 }), // would be a change
      entry(M1, SPEED, { qualityValue: 7 }), // equals the existing value
      entry(M1, OPEN, { qualityValue: 4 }), // would be new
      entry(M2, SPEED, { qualityValue: 6 }), // locked
      entry(M2, SPEED, { qualityValue: 5, quantityValue: 2, qualityComment: 'steady' }), // locked, identical
    ],
    existing,
    problemIndexes: new Set(),
    canViewScores: false,
  });
  // Every non-locked cell collapses to the neutral 'save'; locked stays locked.
  assert.deepEqual(
    cells.map((c) => c.status),
    ['save', 'save', 'save', 'locked', 'locked']
  );
  // The existing values are never sent back, for any cell.
  assert.ok(cells.every((c) => c.from === null));
  // Not even the lock timestamp leaks (it would hint at stored state).
  assert.ok(cells.every((c) => !('lockedAt' in c)));
  // The typed value the user is about to write is still echoed for confirmation.
  assert.deepEqual(
    cells.map((c) => c.to.qualityValue),
    [8, 7, 4, 6, 5]
  );
});

test('counts summarise the preview and its problems', () => {
  const cells = preview([
    entry(M1, SPEED, { qualityValue: 8 }), // change
    entry(M1, SPEED, { qualityValue: 7 }), // unchanged
    entry(M2, SPEED, { qualityValue: 6 }), // locked
    entry(M1, OPEN, { qualityValue: 1 }), // new
  ]);
  assert.deepEqual(previewCounts(cells, [{ index: 9 }, { index: 10 }]), {
    new: 1,
    change: 1,
    unchanged: 1,
    locked: 1,
    save: 0,
    problems: 2,
  });
});

test('redacted counts bucket writes under save, not new/change/unchanged', () => {
  const cells = previewCells({
    entries: [
      entry(M1, SPEED, { qualityValue: 8 }),
      entry(M1, OPEN, { qualityValue: 1 }),
      entry(M2, SPEED, { qualityValue: 6 }),
    ],
    existing,
    problemIndexes: new Set(),
    canViewScores: false,
  });
  assert.deepEqual(previewCounts(cells, []), {
    new: 0,
    change: 0,
    unchanged: 0,
    locked: 1,
    save: 2,
    problems: 0,
  });
});
