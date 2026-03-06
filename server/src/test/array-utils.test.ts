import { describe, it, expect } from 'vitest';
import { groupBy, splitIntoChunks } from '../utils/array-utils';

describe('groupBy', () => {
  it('returns empty map for empty array', () => {
    const result = groupBy([], (x: number) => x);
    expect(result.size).toBe(0);
  });

  it('groups single item', () => {
    const result = groupBy([{ name: 'a', type: 1 }], (x) => x.type);
    expect(result.size).toBe(1);
    expect(result.get(1)).toEqual([{ name: 'a', type: 1 }]);
  });

  it('groups into multiple groups', () => {
    const items = [
      { name: 'a', type: 1 },
      { name: 'b', type: 2 },
      { name: 'c', type: 1 },
    ];
    const result = groupBy(items, (x) => x.type);
    expect(result.size).toBe(2);
    expect(result.get(1)).toEqual([
      { name: 'a', type: 1 },
      { name: 'c', type: 1 },
    ]);
    expect(result.get(2)).toEqual([{ name: 'b', type: 2 }]);
  });

  it('supports numeric keys', () => {
    const result = groupBy([10, 20, 11, 21], (x) => Math.floor(x / 10));
    expect(result.get(1)).toEqual([10, 11]);
    expect(result.get(2)).toEqual([20, 21]);
  });

  it('puts all items in one group when all keys are the same', () => {
    const result = groupBy(['a', 'b', 'c'], () => 'same');
    expect(result.size).toBe(1);
    expect(result.get('same')).toEqual(['a', 'b', 'c']);
  });

  it('supports string keys', () => {
    const items = [
      { val: 1, cat: 'x' },
      { val: 2, cat: 'y' },
      { val: 3, cat: 'x' },
    ];
    const result = groupBy(items, (i) => i.cat);
    expect(result.get('x')!.length).toBe(2);
    expect(result.get('y')!.length).toBe(1);
  });
});

describe('splitIntoChunks', () => {
  it('returns empty array for empty input', () => {
    expect(splitIntoChunks([], 3)).toEqual([]);
  });

  it('splits into exact chunks', () => {
    expect(splitIntoChunks([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('handles non-exact multiple', () => {
    expect(splitIntoChunks([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('handles chunk size of 1', () => {
    expect(splitIntoChunks([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it('handles chunk size larger than array length', () => {
    expect(splitIntoChunks([1, 2], 10)).toEqual([[1, 2]]);
  });

  it('handles single item', () => {
    expect(splitIntoChunks([42], 5)).toEqual([[42]]);
  });

  it('handles chunk size equal to array length', () => {
    expect(splitIntoChunks([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
  });

  it('preserves object references', () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };
    const chunks = splitIntoChunks([obj1, obj2], 1);
    expect(chunks[0][0]).toBe(obj1);
    expect(chunks[1][0]).toBe(obj2);
  });

  it('handles strings', () => {
    expect(splitIntoChunks(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('does not mutate original array', () => {
    const original = [1, 2, 3, 4, 5];
    const copy = [...original];
    splitIntoChunks(original, 2);
    expect(original).toEqual(copy);
  });

  it('handles chunk size of 2 with odd count', () => {
    expect(splitIntoChunks([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('handles large array', () => {
    const arr = Array.from({ length: 100 }, (_, i) => i);
    const chunks = splitIntoChunks(arr, 10);
    expect(chunks.length).toBe(10);
    expect(chunks[0].length).toBe(10);
    expect(chunks[9].length).toBe(10);
  });
});
