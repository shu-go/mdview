import { describe, expect, it } from 'vitest';
import { layoutMarks, type MarkSpan } from './scrollmarks';

describe('layoutMarks', () => {
  it('scales spans to the track', () => {
    const m = layoutMarks([{ kind: 'ins', top: 500, bottom: 1000 }], 2000, 200);
    expect(m).toEqual([{ kind: 'ins', y: 50, h: 50 }]);
  });

  it('gives tiny spans a minimum height and keeps them inside the track', () => {
    expect(layoutMarks([{ kind: 'hit', top: 10, bottom: 12 }], 10000, 100)).toEqual([{ kind: 'hit', y: 0, h: 2 }]);
    expect(layoutMarks([{ kind: 'hit', top: 9998, bottom: 10000 }], 10000, 100)).toEqual([{ kind: 'hit', y: 98, h: 2 }]);
  });

  it('merges touching marks of the same kind', () => {
    const spans: MarkSpan[] = Array.from({ length: 1000 }, (_, i) => ({ kind: 'hit', top: i * 10, bottom: i * 10 + 5 }));
    expect(layoutMarks(spans, 10000, 100)).toEqual([{ kind: 'hit', y: 0, h: 100 }]);
  });

  it('does not merge different kinds, and draws the current hit last', () => {
    const m = layoutMarks(
      [
        { kind: 'current', top: 100, bottom: 110 },
        { kind: 'hit', top: 100, bottom: 110 },
        { kind: 'del', top: 0, bottom: 50 },
      ],
      1000,
      100,
    );
    expect(m.map((x) => x.kind)).toEqual(['del', 'hit', 'current']);
  });

  it('returns nothing without a track', () => {
    expect(layoutMarks([{ kind: 'ins', top: 0, bottom: 1 }], 1000, 0)).toEqual([]);
  });
});
