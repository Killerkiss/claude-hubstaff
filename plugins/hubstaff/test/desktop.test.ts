import { describe, expect, it } from 'vitest';
import { DesktopCli, DesktopCliError, candidateCliPaths } from '../src/desktop.js';

function fakeCli(outputs: Record<string, string>) {
  const calls: string[][] = [];
  const cli = new DesktopCli(async (_bin, args) => {
    calls.push(args);
    return outputs[args[1]] ?? '';
  }, '/fake/HubstaffCLI');
  return { cli, calls };
}

describe('DesktopCli', () => {
  it('parses status', async () => {
    const { cli } = fakeCli({
      status:
        '{"active_project":{"id":250068,"name":"Website","tracked_today":"0:34:15"},"active_task":{"id":1654321,"name":"Merge"},"tracking":true}',
    });
    expect(await cli.status()).toEqual({
      tracking: true,
      project: { id: 250068, name: 'Website', trackedToday: '0:34:15' },
      task: { id: 1654321, name: 'Merge' },
    });
  });

  it('sends start-task with the task id option', async () => {
    const { cli, calls } = fakeCli({ 'start-task': '{}' });
    await cli.startTask(42);
    expect(calls[0]).toEqual(['send', 'start-task', '--task_id', '42']);
  });

  it('turns CLI error text into an error', async () => {
    const { cli } = fakeCli({ stop: "Error executing command: the option '--task_id' is required but missing" });
    await expect(cli.stop()).rejects.toBeInstanceOf(DesktopCliError);
  });

  it('maps projects', async () => {
    const { cli } = fakeCli({
      projects: '{"projects":[{"id":1,"name":"A","organization_id":9,"organization_name":"Org","requires_task":true}]}',
    });
    expect(await cli.projects()).toEqual([{ id: 1, name: 'A', organizationId: 9, organizationName: 'Org', requiresTask: true }]);
  });
});

describe('candidateCliPaths', () => {
  it('knows the standard install locations', () => {
    expect(candidateCliPaths('darwin', '/Users/u')).toContain('/Applications/Hubstaff.app/Contents/MacOS/HubstaffCLI');
    expect(candidateCliPaths('linux', '/home/u')).toContain('/home/u/Hubstaff/HubstaffCLI.bin.x86_64');
  });
});
