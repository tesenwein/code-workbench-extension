import { useState } from 'react';
import type React from 'react';
import type { WorkspaceTask } from '../../types';
import { parseTags } from './taskUtils';

export interface TaskFormFields {
  title: string;
  description: string;
  priority: WorkspaceTask['priority'];
  worktree: string;
  epic: string;
  tags: string[];
}

/** Shared state + submit flow for the task forms: the common fields, a
 *  `submitting` flag, and a `handleSubmit` that guards on a non-empty title,
 *  builds the payload from the trimmed/normalised fields and awaits `onSubmit`.
 *  `build` adds form-specific fields (memo, status, parentId, …). */
export function useTaskForm<T>({
  initial,
  build,
  onSubmit,
}: {
  initial: Partial<Omit<TaskFormFields, 'tags'>> & { tags?: string[] };
  build: (fields: TaskFormFields) => T;
  onSubmit: (payload: T) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [priority, setPriority] = useState<WorkspaceTask['priority']>(initial.priority ?? 'medium');
  const [worktree, setWorktree] = useState(initial.worktree ?? '');
  const [epic, setEpic] = useState(initial.epic ?? '');
  const [tagsInput, setTagsInput] = useState((initial.tags ?? []).join(', '));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(
        build({
          title: title.trim(),
          description,
          priority,
          worktree,
          epic: epic.trim(),
          tags: parseTags(tagsInput),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return {
    title,
    setTitle,
    description,
    setDescription,
    priority,
    setPriority,
    worktree,
    setWorktree,
    epic,
    setEpic,
    tagsInput,
    setTagsInput,
    submitting,
    handleSubmit,
  };
}
