import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiAuthError, HubstaffApi } from '../src/api.js';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const http = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  const statePath = join(mkdtempSync(join(tmpdir(), 'hubstaff-test-')), 'auth.json');
  return { http, calls, statePath };
}

describe('HubstaffApi', () => {
  it('exchanges the PAT, persists the rotated refresh token and reads tasks with keys', async () => {
    const { http, calls, statePath } = setup((url) => {
      if (url.endsWith('/access_tokens')) return json({ access_token: 'acc-1', refresh_token: 'ref-2', expires_in: 3600 });
      return json({ tasks: [{ id: 7, summary: 'Do it', project_id: 3, remote_alternate_id: 'ABC-1', status: 'active' }] });
    });
    const api = new HubstaffApi('pat-1', statePath, http);

    const tasks = await api.projectTasks(3);

    expect(tasks).toEqual([{ id: 7, summary: 'Do it', projectId: 3, key: 'ABC-1', status: 'active', source: 'api' }]);
    expect(String(calls[0].init?.body)).toContain('refresh_token=pat-1');
    expect(calls[1].url).toContain('/projects/3/tasks?page_limit=500&status%5B%5D=active');
    expect(JSON.parse(readFileSync(statePath, 'utf8')).refreshToken).toBe('ref-2');

    await api.projectTasks(3);
    expect(calls.filter((c) => c.url.endsWith('/access_tokens'))).toHaveLength(1);
  });

  it('follows pagination', async () => {
    const { http, statePath } = setup((url) => {
      if (url.endsWith('/access_tokens')) return json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
      if (url.includes('page_start_id=2')) return json({ tasks: [{ id: 2, summary: 'b' }] });
      return json({ tasks: [{ id: 1, summary: 'a' }], pagination: { next_page_start_id: 2 } });
    });
    const tasks = await new HubstaffApi('pat', statePath, http).projectTasks(1);
    expect(tasks.map((t) => t.id)).toEqual([1, 2]);
  });

  it('reports a rejected token clearly', async () => {
    const { http, statePath } = setup(() => json({ error: 'invalid_grant' }, 401));
    await expect(new HubstaffApi('bad', statePath, http).projectTasks(1)).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('is not configured without a token', () => {
    expect(new HubstaffApi(undefined, '/nonexistent', fetch).configured).toBe(false);
  });
});
