import { describe, it, expect } from 'vitest';
import {
  cohortField,
  dashboardPeriodSeq,
  distribution,
  parameterStats,
  studentBreakdown,
  summarize,
  trendSeries,
  unmeasuredStudents,
} from './dashboard.js';

describe('dashboardPeriodSeq', () => {
  const periods = [
    { seq: 1, answeredCount: 12 },
    { seq: 2, answeredCount: 7 },
    { seq: 3, answeredCount: 0 },
  ];
  it('keeps a valid saved period and otherwise prefers the latest populated one', () => {
    expect(dashboardPeriodSeq(periods, 1)).toBe(1);
    expect(dashboardPeriodSeq(periods, 99)).toBe(2);
    expect(dashboardPeriodSeq([{ seq: 4, answeredCount: 0 }], null)).toBe(4);
  });
});

// Server results-grid shape: rows are targets (whole-group row first), cells
// keyed by parameter carrying BOTH dimensions plus the answered state, and
// `previous` the prior period's per-dimension values.
const groupRow = {
  membershipId: null,
  studentId: null,
  fullName: 'Whole group',
  studentCode: null,
  isGroup: true,
  cells: { p1: { quality: 7, quantity: 5, qualityComment: 'ok', quantityComment: null } },
  previous: {},
};
function studentRow(id, fullName, code, cells, previous = {}) {
  return {
    membershipId: `m-${id}`,
    studentId: id,
    fullName,
    studentCode: code,
    isGroup: false,
    cells,
    previous,
  };
}

const results = {
  parameters: [
    { id: 'p1', name: 'Speed', minValue: 0, maxValue: 10 },
    { id: 'p2', name: 'Strength', minValue: null, maxValue: null },
    { id: 'p3', name: 'Never selected', minValue: null, maxValue: null },
  ],
  rows: [
    groupRow,
    studentRow('a', 'Ada', 'S1', {
      p1: { quality: 8, quantity: 3, qualityComment: null, quantityComment: null },
      p2: { quality: 4, quantity: null, qualityComment: 'tries hard', quantityComment: null },
    }, { p1: { quality: 6, quantity: 2 } }),
    studentRow('b', 'Bea', 'S2', {
      p1: { quality: 6, quantity: 6, qualityComment: null, quantityComment: null },
      // comment-only cell for p2 (no values — unanswered on the value basis)
      p2: { quality: null, quantity: null, qualityComment: 'spoke well', quantityComment: null },
    }, { p1: { quality: 6, quantity: 6 } }),
    studentRow('c', 'Cid', 'S3', {}),
  ],
};

describe('summarize', () => {
  it('counts only each student’s selected requirements', () => {
    const s = summarize(results);
    expect(s.students).toBe(3); // the whole-group row never counts
    expect(s.parametersInUse).toBe(2); // p3 has no cells anywhere
    expect(s.expected).toBe(4); // Cid has no selected requirements.
    expect(s.measured).toBe(3); // a:2 + b:1 + c:0 (value basis)
    expect(s.completion).toBe(75);
    expect(s).toMatchObject({ studentsComplete: 1, studentsPartial: 1, studentsNone: 1 });
  });

  it('the basis decides what counts as answered', () => {
    // Ada's p2 cell holds only a comment: not answered on the value basis…
    expect(summarize(results).measured).toBe(3);
    // …but answered once comments count.
    expect(summarize(results, { basis: 'valueOrComment' }).measured).toBe(4);
  });

  it('completion follows the selected dimension and only its own comment', () => {
    expect(summarize(results, { dimension: 'quantity' }).measured).toBe(2);
    // The p2 comments are quality comments, so they do not answer quantity.
    expect(
      summarize(results, { dimension: 'quantity', basis: 'valueOrComment' }).measured
    ).toBe(2);
  });

  it('reports null completion when nothing is expected', () => {
    const empty = { parameters: [], rows: [studentRow('a', 'Ada', 'S1', {})] };
    expect(summarize(empty).completion).toBe(null);
  });
});

describe('cohortField', () => {
  it('classifies each student by completeness, in roster order, group row excluded', () => {
    const field = cohortField(results);
    expect(field.map((dot) => dot.fullName)).toEqual(['Ada', 'Bea', 'Cid']);
    expect(field.map((dot) => dot.state)).toEqual(['full', 'partial', 'none']);
  });
});

describe('parameterStats', () => {
  it('computes count/avg/min/max, the average paired change, and the inUse flag', () => {
    const stats = parameterStats(results);
    const speed = stats.find((stat) => stat.parameter.id === 'p1');
    expect(speed.parameter.inUse).toBe(true);
    expect(speed.count).toBe(2); // student rows only — no group double-count
    expect(speed.average).toBe(7); // (8 + 6) / 2
    expect(speed.min).toBe(6);
    expect(speed.max).toBe(8);
    expect(speed.paired).toBe(2); // both students have a previous quality
    expect(speed.averageChange).toBe(1); // (2 + 0) / 2
    expect(stats.find((stat) => stat.parameter.id === 'p3').parameter.inUse).toBe(false);
  });

  it('switches the value column with the dimension', () => {
    const stats = parameterStats(results, { dimension: 'quantity' });
    const speed = stats.find((stat) => stat.parameter.id === 'p1');
    expect(speed.average).toBe(4.5); // (3 + 6) / 2
    expect(speed.answeredCount).toBe(2);
    expect(stats.find((stat) => stat.parameter.id === 'p2').answeredCount).toBe(0);
  });

  it('keeps numeric count separate from comment-aware coverage', () => {
    const strength = parameterStats(results, { basis: 'valueOrComment' })
      .find((stat) => stat.parameter.id === 'p2');
    expect(strength.count).toBe(1);
    expect(strength.answeredCount).toBe(2);
  });
});

describe('distribution', () => {
  it('bins across the parameter range when one is defined', () => {
    const bins = distribution([1, 5, 9], { minValue: 0, maxValue: 10 });
    expect(bins).toHaveLength(5);
    expect(bins[0].count).toBe(1);
    expect(bins[4].count).toBe(1);
  });

  it('returns a single bin when every value is identical and no range is set', () => {
    expect(distribution([4, 4], { minValue: 4, maxValue: 4 })).toEqual([
      { from: 4, to: 4, label: '4', count: 2 },
    ]);
  });

  it('is empty for no values and no range', () => {
    expect(distribution([], { minValue: null, maxValue: null })).toEqual([]);
  });
});

describe('trendSeries', () => {
  it('walks assignments in name order, each period a labelled point', () => {
    const trends = [
      { parameterId: 'p1', assignmentId: 'a2', assignmentName: 'B', periodSeq: 1, average: 5, count: 3, lastSessionDate: '2024-02-03' },
      { parameterId: 'p1', assignmentId: 'a1', assignmentName: 'A', periodSeq: 2, average: 7, count: 4, lastSessionDate: '2024-01-27' },
      { parameterId: 'p1', assignmentId: 'a1', assignmentName: 'A', periodSeq: 1, average: 6, count: 4, lastSessionDate: '2024-01-06' },
      { parameterId: 'p2', assignmentId: 'a1', assignmentName: 'A', periodSeq: 1, average: 2, count: 1, lastSessionDate: '2024-01-06' },
    ];
    const series = trendSeries({ trends, parameterId: 'p1' });
    expect(series.map((point) => point.label)).toEqual(['A · 1', 'A · 2', 'B · 1']);
    expect(series[0].average).toBe(6);
    expect(series[0].lastSessionDate).toBe('2024-01-06');
  });

  it('is empty when the parameter has no trend rows', () => {
    expect(trendSeries({ trends: [], parameterId: 'p1' })).toEqual([]);
  });
});

describe('studentBreakdown', () => {
  it('lists in-use parameters with the viewed value and paired change', () => {
    const card = studentBreakdown(results, 'a');
    expect(card.fullName).toBe('Ada');
    expect(card.inUse).toBe(2);
    expect(card.rows.find((row) => row.parameter.id === 'p1')).toMatchObject({
      value: 8,
      answered: true,
      change: 2,
    });
  });

  it('a selected-but-unanswered cell is not measured on the value basis', () => {
    const card = studentBreakdown(results, 'b');
    const strength = card.rows.find((row) => row.parameter.id === 'p2');
    expect(strength.value).toBe(null);
    expect(strength.answered).toBe(false);
    expect(card.measured).toBe(1);
    // A comment-only cell answers on the lenient basis.
    const lenient = studentBreakdown(results, 'b', { basis: 'valueOrComment' });
    expect(lenient.rows.find((row) => row.parameter.id === 'p2').answered).toBe(true);
    expect(lenient.measured).toBe(2);
  });

  it('returns an empty-but-shaped record for an unknown student', () => {
    const card = studentBreakdown(results, 'ghost');
    expect(card.fullName).toBe('');
    expect(card.rows).toHaveLength(2);
    expect(card.measured).toBe(0);
  });
});

describe('unmeasuredStudents', () => {
  it('lists the students who still owe answers, worst first', () => {
    const items = unmeasuredStudents(results);
    // Cid has no requirements; Bea owes her selected unanswered cell.
    expect(items.map((item) => item.fullName)).toEqual(['Bea']);
    expect(items[0].missing).toEqual(['Strength']);
  });
});
