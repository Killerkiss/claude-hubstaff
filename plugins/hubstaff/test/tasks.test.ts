import { describe, expect, it } from 'vitest';
import { HubstaffApi } from '../src/api.js';
import { DesktopCli } from '../src/desktop.js';
import { TaskDirectory, looksLikeKey } from '../src/tasks.js';
import type { Task } from '../src/types.js';

const desktop = new DesktopCli(async (_bin, args) => {
  if (args[1] === 'projects') return '{"projects":[{"id":1,"name":"Website"},{"id":2,"name":"Other"}]}';
  if (args[1] === 'tasks' && args[3] === '1')
    return '{"tasks":[{"id":10,"summary":"Fix checkout rounding"},{"id":11,"summary":"Invoice layout"}]}';
  if (args[1] === 'tasks' && args[3] === '2') return '{"tasks":[{"id":20,"summary":"OTHER-5 put the key in the title"}]}';
  return '{}';
}, '/fake');

const cache: Task[] = [
  { id: 10, summary: 'Fix checkout rounding', projectId: 1, key: 'PROJ-743', source: 'cache' },
  { id: 11, summary: 'Invoice layout', projectId: 1, key: 'PROJ-716', source: 'cache' },
];
const noApi = new HubstaffApi(undefined, '/nonexistent');

describe('TaskDirectory', () => {
  it('resolves a key from the local cache', async () => {
    const dir = new TaskDirectory(desktop, noApi, () => cache);
    expect((await dir.resolve('proj-743')).task?.id).toBe(10);
  });

  it('falls back to keys written in task titles', async () => {
    const dir = new TaskDirectory(desktop, noApi, () => cache);
    const res = await dir.resolve('OTHER-5');
    expect(res.task?.id).toBe(20);
  });

  it('explains how to enable API lookup when a key is unknown', async () => {
    const dir = new TaskDirectory(desktop, noApi, () => cache);
    const res = await dir.resolve('NOPE-1');
    expect(res.task).toBeUndefined();
    expect(res.note).toMatch(/personal access token/);
  });

  it('adds keys to desktop task lists', async () => {
    const dir = new TaskDirectory(desktop, noApi, () => cache);
    expect((await dir.tasks(1)).map((t) => t.key)).toEqual(['PROJ-743', 'PROJ-716']);
    expect((await dir.tasks(1, 'invoice')).map((t) => t.id)).toEqual([11]);
  });

  it('matches title words', async () => {
    const dir = new TaskDirectory(desktop, noApi, () => cache);
    expect((await dir.resolve('checkout round')).task?.id).toBe(10);
  });

  it('recognises keys', () => {
    expect(looksLikeKey('PROJ-743')).toBe(true);
    expect(looksLikeKey('merge 743')).toBe(false);
  });
});
