export interface Organization {
  id: number;
  name: string;
}

export interface Project {
  id: number;
  name: string;
  organizationId?: number;
  organizationName?: string;
  requiresTask?: boolean;
}

export interface Task {
  id: number;
  summary: string;
  projectId?: number;
  /** Issue key from the connected tracker (Jira, etc.), e.g. "PROJ-743". */
  key?: string;
  status?: string;
  trackerStatus?: string;
  priority?: string;
  source: 'desktop' | 'cache' | 'api';
}

export interface TrackerStatus {
  tracking: boolean;
  project?: { id: number; name: string; trackedToday?: string };
  task?: { id: number; name: string };
}
