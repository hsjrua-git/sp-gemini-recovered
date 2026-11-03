// Tests for the schema-4 results grid assembly: rows are the assignment's
// evaluation targets — the whole-group row first, then its members — columns
// are parameters, and each cell carries BOTH dimensions plus its answered
// state. `previous` holds the same cells from the assignment's previous
// period (seq − 1) for the change columns; other periods are ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResults } from '../src/lib/results.js';

const speed = { id: 'speed', code: 'speed', name: 'Speed', minValue: 0, maxValue: 10 };
const balance = { id: 'balance', code: 'balance', name: 'Balance', minValue: 1, maxValue: 5 };
const stamina = { id: 'stamina', code: 'stamina', name: 'Stamina', minValue: null, maxValue: null };
const parameters = [speed, balance, stamina];

const targets = [
  { membershipId: 'm1', studentId: 's1', fullName: 'Ana', studentCode: 'AAAAAAAA', addedOn: '2020-01-01', leftOn: null },
  { membershipId: 'm2', studentId: 's2', fullName: 'Ben', studentCode: 'BBBBBBBB', addedOn: '2020-01-01', leftOn: null },
];

const assignment = { id: 'a1', groupId: 'g1', groupName: 'Grade 7' };

const evaluation = (over = {}) => ({
  sessionId: `sess-${over.periodSeq ?? 5}`,
  sessionDate: '2026-01-01',
  membershipId: null,
  parameterId: 'speed',
  qualityValue: null,
  quantityValue: null,
  qualityComment: null,
  quantityComment: null,
  periodSeq: 5,
  ...over,
});

const build = (overrides = {}) =>
  buildResults({
    seq: 5,
    period: { id: 'p5', seq: 5 },
    assignment,
    parameters,
    targets,
    groupName: 'Grade 7',
    evaluations: [],
    ...overrides,
  });

test('a group assignment leads with the whole-group row, then its members', () => {
  const result = build({
    evaluations: [evaluation({ qualityValue: 7, quantityValue: 3 })],
  });
  assert.deepEqual(
    result.rows.map((row) => [row.isGroup, row.fullName, row.studentId, row.membershipId]),
    [
      [true, 'Grade 7', null, null],
      [false, 'Ana', 's1', 'm1'],
      [false, 'Ben', 's2', 'm2'],
    ]
  );
  // The group row's cells come from the membership-less (group) evaluations.
  assert.deepEqual(result.rows[0].cells, {
    speed: { quality: 7, quantity: 3, qualityComment: null, quantityComment: null, answered: true },
  });
  assert.deepEqual(result.rows[0].previous, {});
});

test('current and previous scores are separated; other periods are ignored', () => {
  const result = build({
    evaluations: [
      evaluation({ membershipId: 'm1', qualityValue: 7, periodSeq: 5 }),
      evaluation({ membershipId: 'm1', qualityValue: 6, periodSeq: 4 }),
      evaluation({ membershipId: 'm2', qualityValue: 3, periodSeq: 4 }),
      evaluation({ membershipId: 'm2', parameterId: 'balance', qualityValue: 2, periodSeq: 5 }),
      // A group-keyed evaluation from the previous bucket feeds the group row.
      evaluation({ qualityValue: 5, periodSeq: 4 }),
      // seq − 2 and seq + 1 are neither the current nor the previous bucket.
      evaluation({ membershipId: 'm1', qualityValue: 1, periodSeq: 3 }),
      evaluation({ membershipId: 'm1', qualityValue: 9, periodSeq: 6 }),
    ],
  });
  const [group, ana, ben] = result.rows;
  assert.deepEqual(group.cells, {});
  assert.deepEqual(group.previous, { speed: { quality: 5, quantity: null } });
  assert.deepEqual(ana.cells, { speed: { quality: 7, quantity: null, qualityComment: null, quantityComment: null, answered: true } });
  assert.deepEqual(ana.previous, { speed: { quality: 6, quantity: null } });
  assert.deepEqual(ben.cells, { balance: { quality: 2, quantity: null, qualityComment: null, quantityComment: null, answered: true } });
  assert.deepEqual(ben.previous, { speed: { quality: 3, quantity: null } });
});

test('a cell is answered when any value or comment is set; both-null is selected but unanswered', () => {
  const result = build({
    evaluations: [
      evaluation({ membershipId: 'm1', parameterId: 'speed', qualityComment: 'absent' }),
      evaluation({ membershipId: 'm1', parameterId: 'balance', quantityValue: 4 }),
      evaluation({ membershipId: 'm1', parameterId: 'stamina' }),
      // Comments never reach `previous` — only the two dimensions do.
      evaluation({ membershipId: 'm2', qualityValue: 5, qualityComment: 'good', periodSeq: 4 }),
    ],
  });
  const ana = result.rows[1];
  assert.equal(ana.cells.speed.answered, true);
  assert.equal(ana.cells.balance.answered, true);
  // Explicitly applicable but unanswered: the cell exists, nothing is set.
  assert.deepEqual(ana.cells.stamina, { quality: null, quantity: null, qualityComment: null, quantityComment: null, answered: false });
  const ben = result.rows[2];
  assert.deepEqual(ben.previous, { speed: { quality: 5, quantity: null } });
});

test('an individual assignment has exactly its member and no group row', () => {
  const result = build({
    assignment: { id: 'a1', groupId: null, groupName: null },
    groupName: null,
    targets: [targets[0]],
    evaluations: [
      // A group-keyed evaluation must not bleed into the member's row.
      evaluation({ membershipId: null, qualityValue: 8 }),
      evaluation({ membershipId: 'm1', qualityValue: 7 }),
    ],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].isGroup, false);
  assert.deepEqual(result.rows[0].cells, {
    speed: { quality: 7, quantity: null, qualityComment: null, quantityComment: null, answered: true },
  });
});

test('period 1 has no previous scores; rows without scores stay empty', () => {
  // The route resolves targets (deleted/left students never reach here); an
  // evaluation keyed to a membership that is no longer a target must not leak.
  const result = build({
    seq: 1,
    period: { id: 'p1', seq: 1 },
    evaluations: [evaluation({ membershipId: 'm3', qualityValue: 9 })],
  });
  assert.deepEqual(
    result.rows.map((row) => [row.cells, row.previous]),
    [
      [{}, {}],
      [{}, {}],
      [{}, {}],
    ]
  );
});

test('members inherit both dimensions and previous values from eligible group cells', () => {
  const result = build({ evaluations: [
    evaluation({ periodSeq: 4, qualityValue: 2, quantityValue: 3 }),
    evaluation({ qualityValue: 0, quantityValue: 6 }),
  ] });
  for (const row of result.rows) {
    assert.deepEqual(row.cells.speed, { quality: 0, quantity: 6, qualityComment: null, quantityComment: null, answered: true });
    assert.deepEqual(row.previous.speed, { quality: 2, quantity: 3 });
  }
});

test('own selected-empty and partial cells shadow the entire group cell within a session', () => {
  const group = evaluation({ qualityValue: 8, quantityValue: 9 });
  const own = [evaluation({ membershipId: 'm1' }), evaluation({ membershipId: 'm2', quantityValue: 2 })];
  for (const evaluations of [[group, ...own], [...own, group]]) {
    const { rows } = build({ evaluations });
    assert.deepEqual(rows[1].cells.speed, { quality: null, quantity: null, qualityComment: null, quantityComment: null, answered: false });
    assert.deepEqual(rows[2].cells.speed, { quality: null, quantity: 2, qualityComment: null, quantityComment: null, answered: true });
  }
});

test('fallback is resolved per session before independently averaging each dimension', () => {
  const { rows } = build({ evaluations: [
    evaluation({ sessionId: 'one', qualityValue: 9, quantityValue: 8 }),
    evaluation({ sessionId: 'one', membershipId: 'm1', qualityValue: 3 }),
    evaluation({ sessionId: 'two', qualityValue: 7, quantityValue: 6 }),
    evaluation({ sessionId: 'two', membershipId: 'm2' }),
    evaluation({ sessionId: 'three', quantityValue: 0 }),
    evaluation({ sessionId: 'three', membershipId: 'm2', qualityComment: 'absent' }),
  ] });
  assert.deepEqual(rows[1].cells.speed, { quality: 5, quantity: 3, qualityComment: null, quantityComment: null, answered: true });
  assert.deepEqual(rows[2].cells.speed, { quality: 9, quantity: 8, qualityComment: 'absent', quantityComment: null, answered: true });
});

test('fallback checks inclusive join/leave dates for each current and previous session', () => {
  const { rows } = build({ targets: [
    { ...targets[0], addedOn: '2026-01-02', leftOn: '2026-01-03' },
    { ...targets[1], addedOn: '2026-01-04' },
  ], evaluations: [
    evaluation({ periodSeq: 4, sessionDate: '2026-01-01', qualityValue: 1 }),
    evaluation({ sessionId: 'join', sessionDate: '2026-01-02', quantityValue: 2 }),
    evaluation({ sessionId: 'leave', sessionDate: '2026-01-03', qualityValue: 3 }),
    evaluation({ sessionId: 'after', sessionDate: '2026-01-04', qualityValue: 4 }),
  ] });
  assert.deepEqual(rows[1].cells.speed, { quality: 3, quantity: 2, qualityComment: null, quantityComment: null, answered: true });
  assert.deepEqual(rows[2].cells.speed, { quality: 4, quantity: null, qualityComment: null, quantityComment: null, answered: true });
  assert.deepEqual(rows[1].previous, {});
  assert.deepEqual(rows[2].previous, {});
});
