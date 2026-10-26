import { useState } from 'react';
import { FloppyDisk, FolderOpen, Trash } from '@phosphor-icons/react';

// ─── Storage types ─────────────────────────────────────────────────────────

export interface SavedProject {
  name: string;
  profileId: string;
  files: Record<string, string>;
  savedAt: number;
}

const STORAGE_KEY = 'firmware-academy:saved-projects';
const MAX_SAVES   = 20;

function readSaves(): SavedProject[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SavedProject =>
        s != null &&
        typeof s.name      === 'string' &&
        typeof s.profileId === 'string' &&
        s.files != null && typeof s.files === 'object' &&
        typeof s.savedAt   === 'number',
    );
  } catch {
    return [];
  }
}

function writeSaves(saves: SavedProject[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saves));
  } catch { /* ignore storage-full errors; the UI remains interactive */ }
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${pad(d.getMinutes())}`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export interface SavedProjectsPanelProps {
  profileId: string;
  currentFiles: Record<string, string>;
  onLoad: (files: Record<string, string>) => void;
}

export function SavedProjectsPanel({
  profileId,
  currentFiles,
  onLoad,
}: SavedProjectsPanelProps) {
  const [saves, setSaves] = useState<SavedProject[]>(readSaves);
  const [name, setName]   = useState('');
  const [open, setOpen]   = useState(false);

  // Only show saves for the current profile
  const profileSaves = saves.filter(s => s.profileId === profileId);

  // ── Save ──────────────────────────────────────────────────────────────────

  function doSave() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // Re-read from localStorage to avoid stale React state
    const all = readSaves();
    const hasExisting = all.some(s => s.profileId === profileId && s.name === trimmed);
    if (hasExisting && !window.confirm(`Overwrite saved project "${trimmed}"?`)) return;

    const without = all.filter(s => !(s.profileId === profileId && s.name === trimmed));
    const entry: SavedProject = {
      name: trimmed,
      profileId,
      files: currentFiles,
      savedAt: Date.now(),
    };
    // Prepend new entry, cap total at MAX_SAVES (global, not per profile)
    const updated = [entry, ...without].slice(0, MAX_SAVES);
    writeSaves(updated);
    setSaves(updated);
    setName('');
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  function doLoad(saved: SavedProject) {
    onLoad(saved.files);
    setOpen(false);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function doDelete(saved: SavedProject) {
    if (!window.confirm(`Delete saved project "${saved.name}"?`)) return;
    const all = readSaves();
    const updated = all.filter(
      s => !(s.profileId === saved.profileId && s.name === saved.name),
    );
    writeSaves(updated);
    setSaves(updated);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="saved-projects">

      {/* Save bar: name input + save icon + open-list icon */}
      <div className="saved-projects-bar">
        <input
          className="saved-projects-input"
          type="text"
          placeholder="Save as…"
          value={name}
          maxLength={60}
          aria-label="Save project as"
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') doSave(); }}
        />
        <button
          className="icon-button"
          onClick={doSave}
          disabled={!name.trim()}
          title="Save current project"
          aria-label="Save project"
        >
          <FloppyDisk size={14} />
        </button>
        <button
          className={`icon-button saved-projects-toggle${open ? ' is-open' : ''}`}
          onClick={() => setOpen(v => !v)}
          title="Browse saved projects"
          aria-label={`Saved projects, ${profileSaves.length} for this profile`}
          aria-expanded={open}
          aria-haspopup="listbox"
        >
          <FolderOpen size={14} />
          {profileSaves.length > 0 && (
            <span className="saved-projects-badge" aria-hidden="true">
              {profileSaves.length}
            </span>
          )}
        </button>
      </div>

      {/* Dropdown list */}
      {open && (
        <div className="saved-projects-panel" role="listbox" aria-label="Saved projects">
          {profileSaves.length === 0 ? (
            <p className="saved-projects-empty">
              No saved projects for this profile.
            </p>
          ) : (
            <ul className="saved-projects-list">
              {profileSaves.map(saved => (
                <li
                  key={`${saved.profileId}\x00${saved.name}`}
                  className="saved-project-row"
                  role="option"
                  aria-selected={false}
                >
                  <button
                    className="saved-project-load"
                    onClick={() => doLoad(saved)}
                    title={`Load "${saved.name}"`}
                  >
                    <span className="saved-project-name">{saved.name}</span>
                    <span className="saved-project-date">{fmtDate(saved.savedAt)}</span>
                  </button>
                  <button
                    className="icon-button saved-project-delete"
                    onClick={() => doDelete(saved)}
                    title={`Delete "${saved.name}"`}
                    aria-label={`Delete "${saved.name}"`}
                  >
                    <Trash size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
