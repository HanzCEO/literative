import { Files, Plus } from "@phosphor-icons/react";
import { useProjects, type Project } from "../state/ProjectsContext";

interface ProjectListPageProps {
  onNewProject: () => void;
  onOpenProject: (project: Project) => void;
}

export function ProjectListPage({
  onNewProject,
  onOpenProject,
}: ProjectListPageProps) {
  const { projects, activeProject, removeProject } = useProjects();

  return (
    <div className="project-page">
      <div className="project-page-head">
        <div>
          <h1 className="project-title">Projects</h1>
          <p className="project-subtitle">
            Open a project or create a new one to start designing.
          </p>
        </div>
        <button
          type="button"
          className="toolbar-button toolbar-button-primary"
          onClick={onNewProject}
        >
          <Plus size={16} weight="bold" />
          New project
        </button>
      </div>
      {projects.length === 0 ? (
        <div className="project-empty">
          <Files size={40} weight="duotone" className="project-empty-icon" />
          <p className="project-empty-title">No projects yet</p>
          <p className="project-empty-hint">
            Create your first project to open the editor.
          </p>
          <button
            type="button"
            className="toolbar-button toolbar-button-primary"
            onClick={onNewProject}
          >
            <Plus size={16} weight="bold" />
            New project
          </button>
        </div>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <button
                type="button"
                className={`project-card${
                  activeProject?.id === project.id
                    ? " project-card-active"
                    : ""
                }`}
                onClick={() => onOpenProject(project)}
              >
                <span className="project-card-name">{project.name}</span>
                {project.description && (
                  <span className="project-card-description">
                    {project.description}
                  </span>
                )}
                <span className="project-card-meta">
                  {new Date(project.createdAt).toLocaleDateString()}
                </span>
              </button>
              <button
                type="button"
                className="project-delete"
                aria-label={`Delete ${project.name}`}
                onClick={() => removeProject(project.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
