import type { ProjectId } from '../workbench-contracts';

/** A user-created project: named once, locked to one environment forever.
 * Switching environments means creating a new project — this mirrors how a
 * real embedded project is tied to one toolchain from the moment you start it. */
export type SavedProject = {
  id: string;
  name: string;
  profileId: ProjectId;
  createdAt: number;
  updatedAt: number;
};

const LIST_KEY = 'firmware-academy:project-list';
/** Storage key prefix for a locked project's editable files, isolated per project id
 * so two projects on the same environment never share source. */
export const PROJECT_FILES_PREFIX = 'firmware-academy:project-files:';

function readList(): SavedProject[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedProject =>
      !!item && typeof item === 'object'
      && typeof item.id === 'string' && typeof item.name === 'string'
      && typeof item.profileId === 'string' && typeof item.createdAt === 'number' && typeof item.updatedAt === 'number');
  } catch { return []; }
}

function writeList(list: SavedProject[]): void {
  try { localStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* Projects remain usable for this visit even if storage is full. */ }
}

/** Projects ordered by most recently opened first. */
export function listProjects(): SavedProject[] {
  return readList().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findProject(id: string): SavedProject | undefined {
  return readList().find(item => item.id === id);
}

export function createProject(name: string, profileId: ProjectId): SavedProject {
  const now = Date.now();
  const project: SavedProject = { id: crypto.randomUUID(), name: name.trim() || 'Untitled project', profileId, createdAt: now, updatedAt: now };
  writeList([...readList(), project]);
  return project;
}

/** Bumps a project's position in the recents list when it's opened. */
export function touchProject(id: string): void {
  const list = readList();
  const index = list.findIndex(item => item.id === id);
  if (index < 0) return;
  list[index] = { ...list[index], updatedAt: Date.now() };
  writeList(list);
}

export function deleteProject(id: string): void {
  writeList(readList().filter(item => item.id !== id));
  try { localStorage.removeItem(PROJECT_FILES_PREFIX + id); } catch { /* Best effort cleanup. */ }
}
