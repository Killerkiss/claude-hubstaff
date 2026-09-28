import { describe, expect, it } from 'vitest';
import { candidateDataDirs, parseTaskXml } from '../src/cache.js';
import { taskXml } from './fixtures.js';

describe('parseTaskXml', () => {
  it('reads tasks with their tracker keys', () => {
    const tasks = parseTaskXml(taskXml);
    expect(tasks).toEqual([
      {
        id: 1654321,
        summary: 'Fix checkout rounding bug',
        projectId: 250068,
        key: 'PROJ-743',
        status: 'active',
        trackerStatus: 'In Review',
        priority: 'Medium',
        source: 'cache',
      },
      expect.objectContaining({ id: 1310530, summary: 'Client Meeting', key: undefined }),
    ]);
  });

  it('returns nothing for unrelated XML', () => {
    expect(parseTaskXml('<root><x>1</x></root>')).toEqual([]);
  });
});

describe('candidateDataDirs', () => {
  it('uses the XDG data dir on Linux', () => {
    expect(candidateDataDirs('linux', '/home/u')[0]).toMatch(/Hubstaff\/data$/);
  });
});
