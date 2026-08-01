import { useState } from "react";
import { DotsThree, Files, Plus, Trash } from "@phosphor-icons/react";
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
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

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
        </div>
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <div
                className={`project-card${
                  activeProject?.id === project.id
                    ? " project-card-active"
                    : ""
                }`}
              >
                <button
                  type="button"
                  className="project-card-open"
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
                <div className="project-menu">
                  <button
                    type="button"
                    className="project-menu-trigger"
                    aria-label={`Options for ${project.name}`}
                    aria-expanded={menuOpen === project.id}
                    onClick={() =>
                      setMenuOpen(menuOpen === project.id ? null : project.id)
                    }
                  >
                    <DotsThree size={18} weight="bold" />
                  </button>
                  {menuOpen === project.id && (
                    <>
                      <div
                        className="project-menu-backdrop"
                        onClick={() => setMenuOpen(null)}
                      />
                      <div className="project-menu-popover">
                        <button
                          type="button"
                          className="project-menu-item project-menu-item-danger"
                          onClick={() => {
                            removeProject(project.id);
                            setMenuOpen(null);
                          }}
                        >
                          <Trash size={14} weight="bold" />
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
