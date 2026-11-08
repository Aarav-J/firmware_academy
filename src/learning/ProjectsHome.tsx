import { useState } from 'react';
import { Circuitry, Cpu, Plus, Trash } from '@phosphor-icons/react';
import { useEnvironmentCatalog } from '../environment-catalog';
import { createProject, deleteProject, listProjects } from './projects';
import type { SavedProject } from './projects';
import type { ProjectId } from '../workbench-contracts';
import './projects.css';

function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ProjectsHome({ onOpen }: { onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<SavedProject[]>(listProjects);
  const [creating, setCreating] = useState(false);

  function remove(project: SavedProject) {
    if (!window.confirm(`Delete "${project.name}"? Its files cannot be recovered.`)) return;
    deleteProject(project.id);
    setProjects(listProjects());
  }

  return (
    <div className="projects-home">
      <div className="projects-home-head">
        <div>
          <span className="academy-eyebrow">Your workspaces</span>
          <h1>Projects</h1>
          <p>A project is one environment, locked in from the moment you create it. Need a different board or framework? Start a new project for it.</p>
        </div>
        {!creating && <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} weight="bold" />New project</button>}
      </div>
      {creating && <NewProjectPanel onCancel={() => setCreating(false)} onCreated={id => { setCreating(false); onOpen(id); }} />}
      {projects.length === 0 && !creating && (
        <div className="projects-empty">
          <Circuitry size={34} weight="duotone" />
          <h2>No projects yet</h2>
          <p>Create one, pick its environment, and you're straight into a live firmware workspace.</p>
          <button className="primary-button" onClick={() => setCreating(true)}><Plus size={16} weight="bold" />New project</button>
        </div>
      )}
      {projects.length > 0 && (
        <div className="projects-grid">
          {projects.map(project => (
            <article className="project-card" key={project.id}>
              <button className="project-card-open" onClick={() => onOpen(project.id)}>
                <span className="project-card-env"><Cpu size={14} />{project.profileId}</span>
                <strong>{project.name}</strong>
                <span className="project-card-time">Opened {relativeTime(project.updatedAt)}</span>
              </button>
              <button className="icon-button project-card-delete" aria-label={`Delete ${project.name}`} title="Delete project" onClick={() => remove(project)}><Trash size={16} /></button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function NewProjectPanel({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const catalog = useEnvironmentCatalog();
  const [name, setName] = useState('');
  const [profileId, setProfileId] = useState<ProjectId | null>(null);

  function submit() {
    if (!name.trim() || !profileId) return;
    const project = createProject(name, profileId);
    onCreated(project.id);
  }

  return (
    <section className="new-project-panel" aria-label="Create a project">
      <label className="new-project-name">
        <span>Project name</span>
        <input autoFocus type="text" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Temperature logger" maxLength={60} />
      </label>
      <div className="new-project-environments">
        <span>Environment — this cannot be changed after the project is created</span>
        <div className="environment-grid" role="radiogroup" aria-label="Project environment">
          {catalog.profiles.map(item => (
            <button key={item.id} type="button" role="radio" aria-checked={profileId === item.id} className={`environment-card${profileId === item.id ? ' is-selected' : ''}`} onClick={() => setProfileId(item.id)}>
              <strong>{item.name}</strong>
              <span className="environment-board">{item.board}</span>
              <span className="environment-description">{item.description}</span>
              <span className={`environment-availability${item.available ? ' is-ready' : ''}`}>{item.available ? 'Ready' : item.message}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="new-project-actions">
        <button className="text-button" onClick={onCancel}>Cancel</button>
        <button className="primary-button" disabled={!name.trim() || !profileId} onClick={submit}>Create project →</button>
      </div>
    </section>
  );
}
