import { describe, expect, it } from 'vitest';
import { pageResult, parsePageQuery } from './pagination.js';

describe('parsePageQuery', () => {
  it('defaults to page 1 / size 20', () => {
    expect(parsePageQuery({})).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('parses page and pageSize', () => {
    expect(parsePageQuery({ page: '3', pageSize: '10' })).toEqual({
      page: 3,
      pageSize: 10,
      offset: 20,
    });
  });

  it('clamps invalid / oversized values', () => {
    expect(parsePageQuery({ page: '0', pageSize: '999' })).toEqual({
      page: 1,
      pageSize: 100,
      offset: 0,
    });
    expect(parsePageQuery({ page: 'abc', pageSize: '-5' })).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
    });
  });
});

describe('pageResult', () => {
  it('wraps items with total meta', () => {
    expect(pageResult([{ id: 1 }], 41, 2, 20)).toEqual({
      items: [{ id: 1 }],
      total: 41,
      page: 2,
      pageSize: 20,
    });
  });
});
