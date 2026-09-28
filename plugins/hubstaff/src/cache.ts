import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { envValue } from './env.js';
import { logger } from './logger.js';
import type { Task } from './types.js';

/**
 * Reads the task list the desktop app keeps on disk. It includes the tracker key
 * (`remote_alternate_id`, e.g. a Jira key) that the desktop CLI does not return, and needs no
 * token. The format is undocumented, so any parse problem degrades to "no cache", never an error.
 */

export function candidateDataDirs(platform = process.platform, home = homedir()): string[] {
  const override = envValue('HUBSTAFF_DATA_DIR');
  if (override) return [override];
  switch (platform) {
    case 'darwin':
      return [join(home, 'Library/Application Support/Hubstaff/data'), join(home, 'Library/Application Support/Netsoft/Hubstaff/data')];
    case 'win32': {
      const roots = [process.env.LOCALAPPDATA, process.env.APPDATA].filter(Boolean) as string[];
      return roots.map((root) => join(root, 'Hubstaff', 'data'));
    }
    default:
      return [join(process.env.XDG_DATA_HOME ?? join(home, '.local/share'), 'Hubstaff/data')];
  }
}

/** Finds every `Task.xml` under `<data>/<host>/<account hash>/`, newest first. */
export function findTaskFiles(dirs = candidateDataDirs()): string[] {
  const files: Array<{ path: string; mtime: number }> = [];
  for (const dir of dirs) {
    for (const host of safeReaddir(dir)) {
      for (const account of safeReaddir(join(dir, host))) {
        const path = join(dir, host, account, 'Task.xml');
        try {
          files.push({ path, mtime: statSync(path).mtimeMs });
        } catch {
          // no task cache for this account
        }
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).map((f) => f.path);
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === 'item',
  processEntities: true,
  htmlEntities: true,
});

interface RawItem {
  id?: string;
  summary?: string;
  project?: string;
  attributes?: { item?: Array<{ first?: string; second?: string }> };
}

export function parseTaskXml(xml: string): Task[] {
  const doc = parser.parse(xml) as { boost_serialization?: { items?: { item?: RawItem[] } } };
  const items = doc.boost_serialization?.items?.item ?? [];
  return items.flatMap((item): Task[] => {
    const attrs = new Map<string, string>();
    for (const pair of item.attributes?.item ?? []) {
      if (pair.first) attrs.set(pair.first, pair.second ?? '');
    }
    const id = Number(item.id ?? attrs.get('id'));
    if (!Number.isFinite(id) || id <= 0) return [];
    const projectId = Number(item.project ?? attrs.get('project_id'));
    return [
      {
        id,
        summary: item.summary ?? attrs.get('summary') ?? '',
        projectId: Number.isFinite(projectId) && projectId > 0 ? projectId : undefined,
        key: attrs.get('remote_alternate_id') || undefined,
        status: attrs.get('status') || undefined,
        trackerStatus: attrs.get('jira_status') || undefined,
        priority: attrs.get('priority') || undefined,
        source: 'cache',
      },
    ];
  });
}

let memo: { signature: string; tasks: Task[] } | undefined;

/** All cached tasks across signed-in accounts; re-read only when a file changes. */
export function readCachedTasks(files = findTaskFiles()): Task[] {
  const signature = files
    .map((f) => {
      try {
        return `${f}:${statSync(f).mtimeMs}`;
      } catch {
        return f;
      }
    })
    .join('|');
  if (memo?.signature === signature) return memo.tasks;

  const byId = new Map<number, Task>();
  for (const file of files) {
    try {
      for (const task of parseTaskXml(readFileSync(file, 'utf8'))) {
        if (!byId.has(task.id)) byId.set(task.id, task);
      }
    } catch (error) {
      logger.warn('Could not read Hubstaff task cache', { file, error });
    }
  }
  memo = { signature, tasks: [...byId.values()] };
  return memo.tasks;
}
