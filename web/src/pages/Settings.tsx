import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiRoleSettings, AiSettings } from '@fitness/shared';
import { useEffect, useState } from 'react';
import { fetchAiSettings, updateAiSettings } from '../api';

function RoleCard(props: {
  title: string;
  description: string;
  value: AiRoleSettings;
  onChange: (next: AiRoleSettings) => void;
}) {
  const { title, description, value, onChange } = props;

  const setModel = (index: 0 | 1 | 2, model: string) => {
    const models: [string, string, string] = [...value.models];
    const wasSelected = value.models[index] === value.selected;
    models[index] = model;
    onChange({ models, selected: wasSelected ? model : value.selected });
  };

  return (
    <div className="settings-card">
      <h3>{title}</h3>
      <p className="status">{description}</p>
      {([0, 1, 2] as const).map((i) => (
        <div className="controls" key={i}>
          <input value={value.models[i]} onChange={(e) => setModel(i, e.target.value)} style={{ minWidth: 260 }} />
          <label>
            <input
              type="radio"
              name={`${title}-selected`}
              checked={value.selected === value.models[i]}
              onChange={() => onChange({ ...value, selected: value.models[i] })}
            />{' '}
            active
          </label>
        </div>
      ))}
    </div>
  );
}

export default function Settings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: fetchAiSettings });
  const [draft, setDraft] = useState<AiSettings | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (input: AiSettings) => updateAiSettings(input),
    onSuccess: (saved) => {
      queryClient.setQueryData(['ai-settings'], saved);
    },
  });

  if (!draft) return <p className="status">Loading…</p>;

  return (
    <>
      <p className="status">
        Pick which OpenRouter model each part of the app uses. Up to 3 candidates per role — edit the
        strings freely and mark one active.
      </p>
      <RoleCard
        title="Question AI"
        description="Powers the Chat tab and the Ask AI drawer."
        value={draft.question}
        onChange={(question) => setDraft({ ...draft, question })}
      />
      <RoleCard
        title="Plan AI"
        description="Powers the Training page's plan generator."
        value={draft.plan}
        onChange={(plan) => setDraft({ ...draft, plan })}
      />
      <RoleCard
        title="Analysis AI"
        description="Powers the per-activity AI analysis on the activity detail page."
        value={draft.analysis}
        onChange={(analysis) => setDraft({ ...draft, analysis })}
      />
      <div className="controls">
        <button disabled={save.isPending} onClick={() => save.mutate(draft)}>
          Save
        </button>
        {save.isSuccess && <span className="status">Saved.</span>}
        {save.error && <span className="status">Failed to save: {(save.error as Error).message}</span>}
      </div>
    </>
  );
}
