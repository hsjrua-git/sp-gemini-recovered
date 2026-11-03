// Tests for the schema-4 lock model: lock windows anchor to the SESSION's
// effective date (7 days for a current or future session, 1 for an old one),
// rows are keyed by membership-or-group + parameter, and unlocking needs a
// written reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LATE_LOCK_DAYS,
  NORMAL_LOCK_DAYS,
  cellKey,
  findLockedChanges,
  lockDaysFor,
  locksAtFor,
  parseOverrideReason,
} from '../src/lib/locks.js';

test('current and future sessions get 7 days, older ones 1', () => {
  assert.equal(NORMAL_LOCK_DAYS, 7);
  assert.equal(LATE_LOCK_DAYS, 1);
  assert.equal(lockDaysFor({ sessionDate: '2026-03-10', today: '2026-03-10' }), 7);
  assert.equal(lockDaysFor({ sessionDate: '2026-03-10', today: '2026-03-16' }), 7);
  // The weekly deadline itself begins the late-answer window.
  assert.equal(lockDaysFor({ sessionDate: '2026-03-10', today: '2026-03-17' }), 1);
  // …the day after, it is late.
  assert.equal(lockDaysFor({ sessionDate: '2026-03-10', today: '2026-03-18' }), 1);
  assert.equal(lockDaysFor({ sessionDate: '2026-03-10', today: '2026-04-10' }), 1);
  assert.equal(lockDaysFor({ sessionDate: '2026-06-01', today: '2026-03-10' }), 7);
});

test('UTC deadline mirror leaves unanswered cells open and gives late answers 24 hours', () => {
  assert.equal(locksAtFor({ sessionDate: '2026-03-10' }), null);
  assert.equal(
    locksAtFor({ sessionDate: '2026-03-10', firstAnsweredAt: '2026-03-12T14:30:00Z' }),
    '2026-03-17T00:00:00.000Z'
  );
  assert.equal(
    locksAtFor({ sessionDate: '2026-03-01', firstAnsweredAt: '2026-04-01T14:30:00Z' }),
    '2026-04-02T14:30:00.000Z'
  );
  // Pure day arithmetic — a daylight-saving change in between shifts nothing.
  assert.equal(
    locksAtFor({ sessionDate: '2026-10-24', firstAnsweredAt: '2026-10-24T00:00:00Z' }),
    '2026-10-31T00:00:00.000Z'
  );
});

test('cell keys cover the membership and the parameter, or the whole group', () => {
  assert.equal(cellKey('m1', 'p1'), 'm1:p1');
  assert.equal(cellKey(null, 'p1'), 'group:p1');
  assert.equal(cellKey(undefined, 'p1'), 'group:p1');
});

const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const M1 = '11111111-1111-4111-8111-111111111111';
const M2 = '22222222-2222-4222-8222-222222222222';

const lockedAt = '2026-03-17T00:00:00.000Z';
const existing = new Map([
  [
    cellKey(M1, P),
    {
      selected: true,
      qualityValue: 7,
      quantityValue: null,
      qualityComment: null,
      quantityComment: null,
      isLocked: true,
      locksAt: lockedAt,
    },
  ],
  [
    cellKey(M2, P),
    {
      selected: true,
      qualityValue: 5,
      quantityValue: null,
      qualityComment: 'steady',
      quantityComment: null,
      isLocked: false,
      locksAt: lockedAt,
    },
  ],
  [
    cellKey(null, P),
    {
      selected: true,
      qualityValue: null,
      quantityValue: null,
      qualityComment: null,
      quantityComment: null,
      isLocked: true,
      locksAt: lockedAt,
    },
  ],
]);

const entry = (membershipId, fields = {}) => ({
  membershipId,
  parameterId: P,
  selected: true,
  qualityValue: null,
  quantityValue: null,
  qualityComment: null,
  quantityComment: null,
  ...fields,
});

test('changing a locked value, comment or selection is flagged', () => {
  const flagged = findLockedChanges({
    entries: [
      entry(M1, { qualityValue: 8 }), // value change
      entry(M1, { qualityComment: 're-scored' }), // comment change
      entry(M1, { selected: false }), // removing the row
    ],
    existing,
  });
  assert.deepEqual(
    flagged.map((item) => [item.index, item.membershipId, item.lockedAt]),
    [
      [0, M1, lockedAt],
      [1, M1, lockedAt],
      [2, M1, lockedAt],
    ]
  );
});

test('identical entries and non-locked rows are not flagged', () => {
  assert.deepEqual(
    findLockedChanges({ entries: [entry(M1, { qualityValue: 7 })], existing }),
    []
  );
  // M2's row is open: even a real change is not locked out.
  assert.deepEqual(
    findLockedChanges({ entries: [entry(M2, { qualityValue: 1 })], existing }),
    []
  );
});

test('blind writes to locked cells are value-independent, including blank group cells', () => {
  const entries = [
    entry(M1, { qualityValue: 7 }),
    entry(M1, { qualityValue: 8 }),
    entry(M1, { selected: false }),
    entry(null),
    entry(M2, { qualityValue: 5 }),
    entry('missing'),
  ];
  const flagged = findLockedChanges({ entries, existing, canViewScores: false });
  assert.deepEqual(flagged.map(({ index }) => index), [0, 1, 2, 3]);
  assert.deepEqual(findLockedChanges({ entries, existing }).map(({ index }) => index), [1, 2]);
});

test('the whole-group row uses the group cell key', () => {
  assert.deepEqual(
    findLockedChanges({ entries: [entry(null, { quantityValue: 3 })], existing }),
    [{ index: 0, membershipId: null, parameterId: P, lockedAt }]
  );
  // Same values for the group row: nothing changes, nothing flagged.
  assert.deepEqual(findLockedChanges({ entries: [entry(null)], existing }), []);
});

test('entries without an existing row are not flagged', () => {
  const M9 = '99999999-9999-4999-8999-999999999999';
  assert.deepEqual(
    findLockedChanges({ entries: [entry(M9, { qualityValue: 3 })], existing }),
    []
  );
});

test('missing comment keys count as no comment', () => {
  const bare = {
    membershipId: M1,
    parameterId: P,
    selected: true,
    qualityValue: 7,
    quantityValue: null,
  };
  assert.deepEqual(findLockedChanges({ entries: [bare], existing }), []);
  const flagged = findLockedChanges({
    entries: [{ ...bare, qualityComment: 'late note' }],
    existing,
  });
  assert.deepEqual(
    flagged.map((item) => item.index),
    [0]
  );
});

test('override reasons are trimmed, whitespace-collapsed and length-checked', () => {
  assert.deepEqual(parseOverrideReason('  Corrected\n  after\treview  '), {
    value: 'Corrected after review',
  });
  assert.deepEqual(parseOverrideReason('12345'), { value: '12345' });
  assert.equal(parseOverrideReason('x'.repeat(300)).value, 'x'.repeat(300));
  assert.ok(parseOverrideReason('abc').error);
  assert.ok(parseOverrideReason('     ').error);
  assert.ok(parseOverrideReason('x'.repeat(301)).error);
  assert.ok(parseOverrideReason(undefined).error);
  assert.ok(parseOverrideReason(42).error);
});
