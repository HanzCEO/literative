import { useState, type FormEvent } from "react";

interface NewProjectPageProps {
  onCancel: () => void;
  onCreate: (input: { name: string; description: string }) => void;
}

export function NewProjectPage({ onCancel, onCreate }: NewProjectPageProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    onCreate({ name, description });
  }

  return (
    <div className="project-page">
      <div className="project-page-head">
        <div>
          <h1 className="project-title">New project</h1>
          <p className="project-subtitle">
            Give your poster project a name.
          </p>
        </div>
      </div>
      <form className="new-project-form" onSubmit={handleSubmit}>
        <label className="dialog-field">
          <span className="dialog-label">Name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My first poster"
            aria-label="Project name"
            autoFocus
          />
        </label>
        <label className="dialog-field">
          <span className="dialog-label">Description</span>
          <input
            type="text"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
            aria-label="Project description"
          />
        </label>
        <div className="dialog-footer">
          <button
            type="button"
            className="dialog-button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="dialog-button dialog-button-primary"
            disabled={!name.trim()}
          >
            Create project
          </button>
        </div>
      </form>
    </div>
  );
}
