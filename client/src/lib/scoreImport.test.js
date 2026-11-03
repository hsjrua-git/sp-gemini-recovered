import { describe, it, expect } from 'vitest';
import {
  buildImport,
  guessLayout,
  looksLikeScoreHeader,
  nameKey,
  normalizeCode,
  planImport,
  reasonValid,
} from './scoreImport.js';

const parameters = [
  { id: 'p1', name: 'Speed', minValue: 0, maxValue: 10 },
  { id: 'p2', name: 'Strength', minValue: 0, maxValue: 10 },
];

describe('small helpers', () => {
  it('normalizeCode strips spaces/dashes and upper-cases', () => {
    expect(normalizeCode(' s-1 2 ')).toBe('S12');
  });

  it('nameKey collapses whitespace, lower-cases, normalizes', () => {
    expect(nameKey('  Ada   LOVELACE ')).toBe('ada lovelace');
  });

  it('reasonValid needs 5–300 trimmed characters', () => {
    expect(reasonValid('    ')).toBe(false);
    expect(reasonValid('okay')).toBe(false); // 4 chars
    expect(reasonValid('fixed it')).toBe(true);
    expect(reasonValid('x'.repeat(301))).toBe(false);
  });
});

describe('header detection and layout guessing', () => {
  it('recognises a header row by code, name, or a parameter name (with or without a dimension suffix)', () => {
    expect(looksLikeScoreHeader(['Code', 'Speed'], parameters)).toBe(true);
    expect(looksLikeScoreHeader(['Code', 'Speed (quantity)'], parameters)).toBe(true);
    expect(looksLikeScoreHeader(['random', 'stuff'], parameters)).toBe(false);
  });

  it('maps paired columns per parameter; a bare name maps to quality', () => {
    const layout = guessLayout(
      ['Code', 'Name', 'Speed (quality)', 'Speed (quantity)', 'Strength'],
      parameters
    );
    expect(layout).toEqual({
      codeColumn: 0,
      nameColumn: 1,
      mapping: {
        p1: { qualityColumn: 2, quantityColumn: 3 },
        p2: { qualityColumn: 4, quantityColumn: null },
      },
    });
  });

  it('reports missing code/name columns as null', () => {
    const layout = guessLayout(['Speed'], parameters);
    expect(layout.codeColumn).toBe(null);
    expect(layout.nameColumn).toBe(null);
    expect(layout.mapping).toEqual({
      p1: { qualityColumn: 0, quantityColumn: null },
    });
  });
});

describe('buildImport', () => {
  const studentsByCode = new Map([
    ['S1', { id: 'a', membershipId: 'm-a', fullName: 'Ada Lovelace', studentCode: 'S1' }],
    ['S2', { id: 'b', membershipId: 'm-b', fullName: 'Bea Ray', studentCode: 'S2' }],
    ['S3', { id: 'c', membershipId: null, fullName: 'Cid Bay', studentCode: 'S3' }],
  ]);

  function run(dataCells, mapping) {
    return buildImport({
      rows: [
        { row: 1, cells: ['Code', 'Name', 'Speed (quality)', 'Speed (quantity)'] },
        ...dataCells.map((cells, i) => ({ row: i + 2, cells })),
      ],
      hasHeader: true,
      codeColumn: 0,
      nameColumn: 1,
      mapping:
        mapping ?? { p1: { qualityColumn: 2, quantityColumn: 3 } },
      parameters,
      studentsByCode,
    });
  }

  it('turns valid rows into partial entries without clearing omitted dimensions', () => {
    const built = run([['S1', 'Ada Lovelace', '8', '']]);
    expect(built.entries).toEqual([
      {
        membershipId: 'm-a',
        parameterId: 'p1',
        selected: true,
        qualityValue: 8,
      },
    ]);
    // Both dimension cells share the entry index.
    expect(built.rows[0].cells.map((cell) => cell.entryIndex)).toEqual([0, 0]);
    expect(built.localProblemCount).toBe(0);
  });

  it('flags an unknown code, a name mismatch, and a non-target student', () => {
    const built = run([
      ['S9', '', '5', ''], // no such code
      ['S2', 'Wrong Name', '5', ''], // name mismatch
      ['S3', 'Cid Bay', '5', ''], // not a target of this session's assignment
    ]);
    const problems = built.rows.map((r) => r.rowProblem);
    expect(problems[0]).toMatch(/No student with code/);
    expect(problems[1]).toMatch(/does not match/);
    expect(problems[2]).toMatch(/not part of this session's assignment/);
    expect(built.localProblemCount).toBe(3);
    expect(built.entries).toEqual([]);
  });

  it('flags a duplicate student and an out-of-range dimension value', () => {
    const dup = run([
      ['S1', 'Ada Lovelace', '8', ''],
      ['S1', 'Ada Lovelace', '9', ''],
    ]);
    expect(dup.rows[1].rowProblem).toMatch(/Same student as row/);

    const bad = run([['S1', 'Ada Lovelace', '101', '']]);
    expect(bad.rows[0].cells[0].problem).toMatch(/Quality: at most/i);
    expect(bad.localProblemCount).toBe(1);
    expect(bad.entries).toEqual([]);
  });

  it('imports a quantity-only pair and counts blanks', () => {
    const built = run([['S1', 'Ada Lovelace', '', '7']]);
    expect(built.entries).toEqual([
      {
        membershipId: 'm-a',
        parameterId: 'p1',
        selected: true,
        quantityValue: 7,
      },
    ]);
    // Only the blank quality cell counts as blank; the pair shares one entry.
    expect(built.blankCells).toBe(1);
  });
});

describe('planImport', () => {
  const built = {
    entries: [
      { membershipId: 'm-a', parameterId: 'p1', selected: true, qualityValue: 8, quantityValue: null },
      { membershipId: 'm-b', parameterId: 'p1', selected: true, qualityValue: 5, quantityValue: null },
      { membershipId: 'm-c', parameterId: 'p1', selected: true, qualityValue: 7, quantityValue: null },
    ],
    localProblemCount: 0,
  };
  const server = {
    problems: [],
    cells: [
      { index: 0, status: 'new' },
      { index: 1, status: 'unchanged' },
      { index: 2, status: 'locked' },
    ],
  };

  it('sends new/changed rows, skips unchanged, and needs override for locked', () => {
    const plan = planImport({ built, server, canOverride: true });
    expect(plan.send.map((e) => e.membershipId).sort()).toEqual(['m-a', 'm-c']);
    expect(plan.unchanged).toBe(1);
    expect(plan.lockedOverride).toBe(1);
    expect(plan.lockedBlocked).toBe(0);
  });

  it('blocks locked rows when the user cannot override', () => {
    const plan = planImport({ built, server, canOverride: false });
    expect(plan.send.map((e) => e.membershipId)).toEqual(['m-a']); // c is locked+blocked
    expect(plan.lockedBlocked).toBe(1);
    expect(plan.problemCount).toBe(1);
  });

  it('treats a redacted "save" status (blind entry) as a plain write', () => {
    const redacted = {
      problems: [],
      cells: [
        { index: 0, status: 'save' },
        { index: 1, status: 'save' },
        { index: 2, status: 'locked' },
      ],
    };
    const plan = planImport({ built, server: redacted, canOverride: true });
    expect(plan.send).toHaveLength(3); // both saves + the overridable locked
    expect(plan.unchanged).toBe(0);
  });
});
