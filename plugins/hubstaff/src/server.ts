import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logger } from './logger.js';
import { TaskDirectory } from './tasks.js';
import type { Task, TrackerStatus } from './types.js';

declare const __VERSION__: string;

export function formatTask(t: Task, projectNames?: Map<number, string>): string {
  const project = t.projectId && projectNames?.get(t.projectId);
  const meta = [t.trackerStatus, project ? `project: ${project}` : undefined, `id ${t.id}`].filter(Boolean).join(', ');
  return `${t.key ? `${t.key} · ` : ''}${t.summary || '(no summary)'} (${meta})`;
}

export function formatStatus(s: TrackerStatus): string {
  if (!s.project) return s.tracking ? 'Tracking (no project reported).' : 'Not tracking.';
  const what = `${s.project.name}${s.task ? ` → ${s.task.name} (task id ${s.task.id})` : ''}`;
  const today = s.project.trackedToday ? `; today on this project: ${s.project.trackedToday}` : '';
  return `${s.tracking ? 'Tracking' : 'Stopped. Last selected'}: ${what}${today}`;
}

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const fail = (error: unknown) => ({
  content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  isError: true,
});

export function createServer(dir = new TaskDirectory()): McpServer {
  const server = new McpServer({ name: 'hubstaff', version: typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0' });

  const projectNames = async () => new Map((await dir.projects()).map((p) => [p.id, p.name]));
  const settle = () => new Promise((r) => setTimeout(r, 1200));

  server.registerTool(
    'status',
    {
      title: 'Hubstaff timer status',
      description: 'What the Hubstaff desktop timer is tracking right now (project, task, time today).',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        return text(formatStatus(await dir.desktop.status()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'projects',
    {
      title: 'List Hubstaff projects',
      description: 'Projects you can track time on in the Hubstaff desktop app.',
      inputSchema: { organization_id: z.number().int().optional().describe('Only projects of this organization') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ organization_id }) => {
      try {
        const projects = await dir.projects(organization_id);
        if (!projects.length) return text('No projects available.');
        const lines = projects.map(
          (p) => `${p.name} (id ${p.id}${p.organizationName ? `, ${p.organizationName}` : ''}${p.requiresTask ? ', task required' : ''})`,
        );
        return text(lines.join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'tasks',
    {
      title: 'List Hubstaff tasks',
      description: 'Trackable tasks of a project with their tracker keys (e.g. Jira keys). Optional text filter.',
      inputSchema: {
        project_id: z.number().int().describe('Hubstaff project id (see the projects tool)'),
        query: z.string().optional().describe('Words or key to filter by'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ project_id, query }) => {
      try {
        const tasks = await dir.tasks(project_id, query);
        if (!tasks.length) return text(query ? `No tasks match "${query}".` : 'No tasks in this project.');
        return text(tasks.map((t) => formatTask(t)).join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'find_task',
    {
      title: 'Find a Hubstaff task',
      description: 'Find a task by tracker key (e.g. "PROJ-743"), Hubstaff task id, or words from its title.',
      inputSchema: {
        ref: z.string().min(1).describe('Tracker key, task id, or title words'),
        project_id: z.number().int().optional().describe('Limit to one project'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ ref, project_id }) => {
      try {
        const [res, names] = [await dir.resolve(ref, project_id), await projectNames()];
        if (res.task) return text(`${formatTask(res.task, names)}${res.note ? `\n(${res.note})` : ''}`);
        const list = res.candidates.map((t) => `- ${formatTask(t, names)}`).join('\n');
        return text([res.note, list].filter(Boolean).join('\n'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'start',
    {
      title: 'Start Hubstaff timer',
      description:
        'Start tracking a task (by tracker key like "PROJ-743", task id, or unique title words), or a whole project when only project_id is given. Switches away from whatever is currently tracked.',
      inputSchema: {
        task: z.string().optional().describe('Tracker key, task id, or title words'),
        project_id: z.number().int().optional().describe('Project to track, or to narrow the task search'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ task, project_id }) => {
      try {
        if (!task && !project_id) return fail(new Error('Give a task (key, id or title words) or a project_id.'));
        const before = await dir.desktop.status().catch(() => undefined);

        if (task) {
          const res = await dir.resolve(task, project_id);
          if (!res.task) {
            const names = await projectNames();
            const list = res.candidates.map((t) => `- ${formatTask(t, names)}`).join('\n');
            return fail(new Error([res.note ?? 'Task not found.', list && `Candidates:\n${list}`].filter(Boolean).join('\n')));
          }
          await dir.desktop.startTask(res.task.id);
        } else {
          await dir.desktop.startProject(project_id!);
        }

        await settle();
        const after = await dir.desktop.status();
        const switched = before?.tracking && before.task?.id !== after.task?.id ? `\nStopped: ${formatStatus(before).replace(/^Tracking: /, '')}` : '';
        return text(`${formatStatus(after)}${switched}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'stop',
    {
      title: 'Stop Hubstaff timer',
      description: 'Stop the Hubstaff desktop timer.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const before = await dir.desktop.status();
        if (!before.tracking) return text(`Already stopped. ${formatStatus(before)}`);
        await dir.desktop.stop();
        await settle();
        return text(`Stopped ${formatStatus(before).replace(/^Tracking: /, '')}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'resume',
    {
      title: 'Resume Hubstaff timer',
      description: 'Resume tracking the last selected project or task.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      try {
        await dir.desktop.resume();
        await settle();
        return text(formatStatus(await dir.desktop.status()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

export async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  logger.info('hubstaff MCP server ready');
}
