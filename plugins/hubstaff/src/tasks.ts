import { HubstaffApi } from './api.js';
import { readCachedTasks } from './cache.js';
import { DesktopCli } from './desktop.js';
import { logger } from './logger.js';
import type { Project, Task } from './types.js';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*-\d+$/i;
const API_TTL_MS = 5 * 60_000;

export function looksLikeKey(ref: string): boolean {
  return KEY_PATTERN.test(ref.trim());
}

export interface Resolution {
  task?: Task;
  candidates: Task[];
  /** Where the answer came from, or why nothing matched. */
  note?: string;
}

/**
 * Combines the three task sources: the desktop CLI (what you can actually track), the desktop
 * app's local cache (tracker keys, no auth) and the public API (tracker keys, needs a token).
 */
export class TaskDirectory {
  private apiCache = new Map<number, { at: number; tasks: Task[] }>();

  constructor(
    readonly desktop = new DesktopCli(),
    readonly api = new HubstaffApi(),
    private readonly cached: () => Task[] = readCachedTasks,
  ) {}

  async projects(organizationId?: number): Promise<Project[]> {
    return this.desktop.projects(organizationId);
  }

  private async apiTasks(projectId: number): Promise<Task[]> {
    const hit = this.apiCache.get(projectId);
    if (hit && Date.now() - hit.at < API_TTL_MS) return hit.tasks;
    const tasks = await this.api.projectTasks(projectId);
    this.apiCache.set(projectId, { at: Date.now(), tasks });
    return tasks;
  }

  /** Trackable tasks of a project, with tracker keys filled in where any source has them. */
  async tasks(projectId: number, query?: string): Promise<Task[]> {
    const tasks = await this.desktop.tasks(projectId);
    const keys = new Map<number, Task>();
    for (const t of this.cached()) if (t.key) keys.set(t.id, t);

    if (this.api.configured && tasks.some((t) => !keys.has(t.id))) {
      try {
        for (const t of await this.apiTasks(projectId)) if (t.key) keys.set(t.id, t);
      } catch (error) {
        logger.warn('Hubstaff API task lookup failed; showing tasks without keys', { projectId, error });
      }
    }

    const enriched = tasks.map((t) => {
      const extra = keys.get(t.id);
      return extra ? { ...t, key: extra.key, trackerStatus: extra.trackerStatus, priority: extra.priority } : t;
    });
    return query ? enriched.filter((t) => matches(t, query)) : enriched;
  }

  /** Resolves a task id, tracker key (e.g. "PROJ-743") or words from the summary. */
  async resolve(ref: string, projectId?: number): Promise<Resolution> {
    const needle = ref.trim();
    if (/^\d+$/.test(needle)) {
      const id = Number(needle);
      const known = this.cached().find((t) => t.id === id);
      return { task: known ?? { id, summary: '', source: 'desktop' }, candidates: [] };
    }

    if (looksLikeKey(needle)) {
      const byKey = (list: Task[]) => list.filter((t) => t.key?.toUpperCase() === needle.toUpperCase());
      const fromCache = byKey(this.cached()).filter((t) => !projectId || t.projectId === projectId);
      if (fromCache.length === 1) return { task: fromCache[0], candidates: [], note: 'matched key in local Hubstaff cache' };

      const projectIds = projectId ? [projectId] : (await this.projects()).map((p) => p.id);
      if (this.api.configured) {
        const fromApi = byKey(await this.fanOut(projectIds, (id) => this.apiTasks(id)));
        if (fromApi.length === 1) return { task: fromApi[0], candidates: [], note: 'matched key via Hubstaff API' };
        if (fromApi.length > 1) return { candidates: fromApi, note: 'key matches several tasks' };
      }

      // Last resort: teams that put the key in the task title.
      const inTitle = (await this.fanOut(projectIds, (id) => this.desktop.tasks(id))).filter((t) => matches(t, needle));
      if (inTitle.length === 1) return { task: inTitle[0], candidates: [], note: 'matched key in task title' };
      return {
        candidates: inTitle,
        note: this.api.configured
          ? `No task with key ${needle}.`
          : `No task with key ${needle} in the local cache. Set a Hubstaff personal access token in the plugin settings to search via the API.`,
      };
    }

    const pool = projectId ? await this.tasks(projectId) : this.cached();
    const found = pool.filter((t) => matches(t, needle) && (!projectId || t.projectId === projectId));
    if (found.length === 1) return { task: found[0], candidates: [] };
    return { candidates: found.slice(0, 20), note: found.length ? 'several tasks match' : `No task matches "${needle}".` };
  }

  /** Runs a per-project lookup everywhere, keeping what succeeds and logging each failure. */
  private async fanOut(projectIds: number[], load: (projectId: number) => Promise<Task[]>): Promise<Task[]> {
    const results: Task[] = [];
    const limit = 5;
    for (let i = 0; i < projectIds.length; i += limit) {
      const batch = projectIds.slice(i, i + limit);
      const settled = await Promise.allSettled(batch.map((id) => load(id)));
      settled.forEach((outcome, j) => {
        if (outcome.status === 'rejected') {
          logger.error('Task lookup failed for project', { projectId: batch[j], error: outcome.reason });
        } else {
          results.push(...outcome.value);
        }
      });
    }
    return results;
  }
}

function matches(task: Task, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${task.key ?? ''} ${task.summary}`.toLowerCase();
  return words.every((w) => haystack.includes(w));
}
