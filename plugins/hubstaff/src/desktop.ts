import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { envValue } from './env.js';
import { logger } from './logger.js';
import type { Organization, Project, Task, TrackerStatus } from './types.js';

/**
 * Wraps the CLI that ships with the Hubstaff desktop app. It talks to the running app over
 * local IPC, so timers started here behave exactly like clicking Start (screenshots, activity).
 * Hubstaff's public API has no start/stop endpoint, which is why the plugin needs this.
 */

export class DesktopCliError extends Error {}

export function candidateCliPaths(platform = process.platform, home = homedir()): string[] {
  const fromEnv = envValue('HUBSTAFF_CLI_PATH') ? [envValue('HUBSTAFF_CLI_PATH')!] : [];
  switch (platform) {
    case 'darwin':
      return [
        ...fromEnv,
        '/Applications/Hubstaff.app/Contents/MacOS/HubstaffCLI',
        join(home, 'Applications/Hubstaff.app/Contents/MacOS/HubstaffCLI'),
      ];
    case 'win32': {
      const programFiles = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean) as string[];
      const localAppData = process.env.LOCALAPPDATA;
      return [
        ...fromEnv,
        ...programFiles.flatMap((dir) => [
          join(dir, 'Hubstaff', 'HubstaffCLI.exe'),
          join(dir, 'Hubstaff', 'HubstaffCLI', 'HubstaffCLI.exe'),
        ]),
        ...(localAppData ? [join(localAppData, 'Programs', 'Hubstaff', 'HubstaffCLI.exe')] : []),
      ];
    }
    default:
      return [
        ...fromEnv,
        ...[join(home, 'Hubstaff'), '/opt/Hubstaff', '/usr/local/Hubstaff'].flatMap((dir) => [
          join(dir, 'HubstaffCLI.bin.x86_64'),
          join(dir, 'HubstaffCLI.bin.x86'),
        ]),
      ];
  }
}

export function findCli(): string {
  const candidates = candidateCliPaths();
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new DesktopCliError(
      `Hubstaff desktop CLI not found. Install the Hubstaff desktop app, or set HUBSTAFF_CLI_PATH. Looked in: ${candidates.join(', ')}`,
    );
  }
  return found;
}

type Runner = (bin: string, args: string[]) => Promise<string>;

const execRunner: Runner = (bin, args) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
      const output = `${stdout ?? ''}${stderr ?? ''}`.trim();
      // The CLI reports some failures on stdout with exit code 0, so callers inspect the text too.
      if (error && !output) reject(error);
      else resolve(output);
    });
  });

function parseJson(output: string): unknown {
  const start = output.search(/[{[]/);
  if (start === -1) return undefined;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return undefined;
  }
}

export class DesktopCli {
  private bin?: string;

  constructor(private readonly run: Runner = execRunner, bin?: string) {
    this.bin = bin;
  }

  private async send(command: string, options: Record<string, string | number> = {}): Promise<unknown> {
    this.bin ??= findCli();
    const args = ['send', command, ...Object.entries(options).flatMap(([k, v]) => [`--${k}`, String(v)])];
    logger.debug('hubstaff cli', { args });
    const output = await this.run(this.bin, args);
    if (/^Error\b|error executing command/i.test(output)) {
      throw new DesktopCliError(`${output}${hintFor(output)}`);
    }
    const parsed = parseJson(output);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      throw new DesktopCliError(`${String((parsed as { error: unknown }).error)}${hintFor(output)}`);
    }
    return parsed ?? output;
  }

  async ready(): Promise<{ loggedIn: boolean; online: boolean; ready: boolean }> {
    const r = (await this.send('wait-login')) as Record<string, boolean>;
    return { loggedIn: !!r.logged_in, online: !!r.network_online, ready: !!r.ready };
  }

  async status(): Promise<TrackerStatus> {
    const r = (await this.send('status')) as {
      tracking?: boolean;
      active_project?: { id: number; name: string; tracked_today?: string };
      active_task?: { id: number; name: string };
    };
    return {
      tracking: !!r.tracking,
      project: r.active_project
        ? { id: r.active_project.id, name: r.active_project.name, trackedToday: r.active_project.tracked_today }
        : undefined,
      task: r.active_task ? { id: r.active_task.id, name: r.active_task.name } : undefined,
    };
  }

  async organizations(): Promise<Organization[]> {
    const r = (await this.send('organizations')) as { organizations?: Organization[] };
    return (r.organizations ?? []).map(({ id, name }) => ({ id, name }));
  }

  async projects(organizationId?: number): Promise<Project[]> {
    const r = (await this.send('projects', organizationId ? { organization_id: organizationId } : {})) as {
      projects?: Array<{ id: number; name: string; organization_id?: number; organization_name?: string; requires_task?: boolean }>;
    };
    return (r.projects ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      organizationId: p.organization_id,
      organizationName: p.organization_name,
      requiresTask: p.requires_task,
    }));
  }

  async tasks(projectId: number): Promise<Task[]> {
    const r = (await this.send('tasks', { project_id: projectId })) as { tasks?: Array<{ id: number; summary: string }> };
    return (r.tasks ?? []).map((t) => ({ id: t.id, summary: t.summary, projectId, source: 'desktop' as const }));
  }

  async startTask(taskId: number): Promise<unknown> {
    return this.send('start-task', { task_id: taskId });
  }

  async startProject(projectId: number): Promise<unknown> {
    return this.send('start-project', { project_id: projectId });
  }

  async stop(): Promise<unknown> {
    return this.send('stop');
  }

  async resume(): Promise<unknown> {
    return this.send('resume');
  }
}

function hintFor(output: string): string {
  if (/not running|connect|ipc/i.test(output)) return ' (Is the Hubstaff desktop app running and signed in?)';
  if (/permission|denied|allow/i.test(output)) {
    return ' (Hubstaff asks once to allow remote control: choose "Always allow" in the desktop app.)';
  }
  return '';
}
