import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { envValue } from './env.js';
import { logger } from './logger.js';
import type { Task } from './types.js';

/**
 * Minimal client for the Hubstaff public API (v2), used only to read tasks with their tracker
 * keys. Authentication follows Hubstaff's own CLI: the personal access token is a refresh token;
 * exchanging it returns a short-lived access token and a *new* refresh token, which must be
 * persisted because the old one may stop working.
 */

const API_URL = envValue('HUBSTAFF_API_URL') ?? 'https://api.hubstaff.com/v2';
const AUTH_URL = envValue('HUBSTAFF_AUTH_URL') ?? 'https://account.hubstaff.com';
const REFRESH_SKEW_SECONDS = 120;

export class ApiAuthError extends Error {}

interface StoredAuth {
  patFingerprint: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

function fingerprint(pat: string): string {
  return createHash('sha256').update(pat).digest('hex').slice(0, 16);
}

export function defaultStatePath(): string {
  const dir = envValue('HUBSTAFF_STATE_DIR') ?? join(homedir(), '.config', 'claude-hubstaff');
  return join(dir, 'auth.json');
}

type Fetch = typeof fetch;

export class HubstaffApi {
  private refreshing?: Promise<string>;

  constructor(
    private readonly pat: string | undefined = envValue('HUBSTAFF_PAT'),
    private readonly statePath = defaultStatePath(),
    private readonly http: Fetch = fetch,
  ) {}

  get configured(): boolean {
    return !!this.pat;
  }

  private load(): StoredAuth | undefined {
    if (!this.pat) return undefined;
    try {
      const stored = JSON.parse(readFileSync(this.statePath, 'utf8')) as StoredAuth;
      // A different token in settings means the user re-authenticated: start over from it.
      if (stored.patFingerprint === fingerprint(this.pat)) return stored;
    } catch {
      // first run or unreadable state
    }
    return { patFingerprint: fingerprint(this.pat), refreshToken: this.pat };
  }

  private save(auth: StoredAuth): void {
    mkdirSync(dirname(this.statePath), { recursive: true, mode: 0o700 });
    writeFileSync(this.statePath, JSON.stringify(auth), { mode: 0o600 });
    try {
      chmodSync(this.statePath, 0o600);
    } catch {
      // not supported on this platform
    }
  }

  private async exchange(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in?: number }> {
    const res = await this.http(`${AUTH_URL}/access_tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) {
      const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
      throw retryable
        ? new Error(`Hubstaff auth service unavailable (HTTP ${res.status}); try again shortly.`)
        : new ApiAuthError(
            'Hubstaff rejected the personal access token. Create a new one at https://developer.hubstaff.com/personal_access_tokens and update the plugin setting.',
          );
    }
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!body.access_token || !body.refresh_token) throw new ApiAuthError('Hubstaff returned an incomplete token response.');
    return body as { access_token: string; refresh_token: string; expires_in?: number };
  }

  private async accessToken(force = false): Promise<string> {
    const auth = this.load();
    if (!auth) throw new ApiAuthError('No Hubstaff personal access token configured.');
    const now = Math.floor(Date.now() / 1000);
    if (!force && auth.accessToken && (auth.expiresAt ?? 0) > now + REFRESH_SKEW_SECONDS) return auth.accessToken;

    // One refresh at a time: parallel refreshes would race on the rotating refresh token.
    this.refreshing ??= (async () => {
      try {
        let tokens;
        try {
          tokens = await this.exchange(auth.refreshToken);
        } catch (error) {
          // The stored rotated token can be revoked while the configured PAT is still valid.
          if (!(error instanceof ApiAuthError) || auth.refreshToken === this.pat) throw error;
          logger.warn('Stored Hubstaff refresh token rejected; retrying with the configured token');
          tokens = await this.exchange(this.pat!);
        }
        this.save({
          patFingerprint: auth.patFingerprint,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          expiresAt: tokens.expires_in ? now + tokens.expires_in : undefined,
        });
        return tokens.access_token;
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  async get<T>(path: string, query: Record<string, string | number | Array<string | number>> = {}): Promise<T> {
    const url = new URL(`${API_URL}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(`${key}[]`, String(v)));
      else url.searchParams.set(key, String(value));
    }
    let res = await this.http(url, { headers: { authorization: `Bearer ${await this.accessToken()}` } });
    if (res.status === 401) {
      res = await this.http(url, { headers: { authorization: `Bearer ${await this.accessToken(true)}` } });
    }
    if (!res.ok) throw new Error(`Hubstaff API ${path} failed: HTTP ${res.status} ${await res.text().catch(() => '')}`.trim());
    return (await res.json()) as T;
  }

  /** Active tasks of one project, all pages. */
  async projectTasks(projectId: number): Promise<Task[]> {
    const tasks: Task[] = [];
    let pageStartId: number | undefined;
    for (let page = 0; page < 50; page++) {
      const body = await this.get<{ tasks?: ApiTask[]; pagination?: { next_page_start_id?: number } }>(
        `/projects/${projectId}/tasks`,
        { page_limit: 500, status: ['active'], ...(pageStartId ? { page_start_id: pageStartId } : {}) },
      );
      tasks.push(...(body.tasks ?? []).map(toTask));
      pageStartId = body.pagination?.next_page_start_id;
      if (!pageStartId) break;
    }
    return tasks;
  }
}

interface ApiTask {
  id: number;
  summary?: string;
  project_id?: number;
  remote_alternate_id?: string | null;
  status?: string;
}

function toTask(t: ApiTask): Task {
  return {
    id: t.id,
    summary: t.summary ?? '',
    projectId: t.project_id,
    key: t.remote_alternate_id || undefined,
    status: t.status,
    source: 'api',
  };
}
