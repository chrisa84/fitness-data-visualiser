import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Tag } from '@fitness/shared';
import { TAG_COLOURS } from '@fitness/shared';
import { createTag, deleteTag, updateTag } from '../api';
import TagChip from '../TagChip';
import { TAGS_QUERY_KEY, useTags } from '../tags';

/**
 * Manage the labels you attach to individual activities. Tags are the
 * per-activity counterpart to the Events page's date-ranged annotations —
 * "took an antihistamine before this run" belongs here, "chest infection,
 * 10th to 20th" belongs there.
 */

function ColourPicker({ value, onChange }: { value: string | null; onChange: (c: string | null) => void }) {
  return (
    <span className="tag-list">
      {TAG_COLOURS.map((colour) => (
        <button
          key={colour}
          type="button"
          aria-label={`colour ${colour}`}
          aria-pressed={value === colour}
          onClick={() => onChange(value === colour ? null : colour)}
          style={{
            width: 22,
            height: 22,
            padding: 0,
            borderRadius: '50%',
            background: colour,
            border: value === colour ? '2px solid #e6e8eb' : '1px solid #3a4250',
          }}
        />
      ))}
    </span>
  );
}

function TagRow({ tag }: { tag: Tag }) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
    // Activity rows carry tag ids, so a rename or delete changes what they show.
    void queryClient.invalidateQueries({ queryKey: ['activities'] });
  };

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [colour, setColour] = useState<string | null>(tag.colour);

  const save = useMutation({
    mutationFn: () => updateTag(tag.id, { name: name.trim(), colour }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const remove = useMutation({ mutationFn: () => deleteTag(tag.id), onSuccess: invalidate });

  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <div className="controls" style={{ marginBottom: 0 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ minWidth: 180 }} />
            <ColourPicker value={colour} onChange={setColour} />
            <button disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              Save
            </button>
            <button
              onClick={() => {
                setName(tag.name);
                setColour(tag.colour);
                save.reset();
                setEditing(false);
              }}
            >
              Cancel
            </button>
            {save.error && <span className="status">{(save.error as Error).message}</span>}
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <TagChip tag={tag} />
      </td>
      <td className="num">{tag.activityCount}</td>
      <td>
        {tag.activityCount > 0 ? (
          <Link to={`/activities?tags=${tag.id}`}>view activities</Link>
        ) : (
          <span className="status">unused</span>
        )}
      </td>
      <td>
        <button onClick={() => setEditing(true)}>edit</button>{' '}
        <button
          disabled={remove.isPending}
          onClick={() => {
            const warning =
              tag.activityCount > 0
                ? `Delete "${tag.name}"? It will be removed from ${tag.activityCount} activit${tag.activityCount === 1 ? 'y' : 'ies'}.`
                : `Delete "${tag.name}"?`;
            if (confirm(warning)) remove.mutate();
          }}
        >
          delete
        </button>
      </td>
    </tr>
  );
}

export default function Tags() {
  const queryClient = useQueryClient();
  const tags = useTags();
  const [name, setName] = useState('');
  const [colour, setColour] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createTag({ name: name.trim(), colour }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TAGS_QUERY_KEY });
      setName('');
      setColour(null);
    },
  });

  return (
    <>
      <h2>Tags</h2>
      <p className="status">
        Your own labels for individual activities — "antihistamine", "stressful work day", "new
        shoes". Attach them on an activity's page, then filter the{' '}
        <Link to="/activities">activity list</Link> by them. For something that spans days (an
        injury, a holiday, a course of medication) use <Link to="/events">Events</Link> instead, so
        it can be overlaid on the charts.
      </p>

      <div className="controls">
        <input
          placeholder="New tag name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) create.mutate();
          }}
          style={{ minWidth: 200 }}
        />
        <ColourPicker value={colour} onChange={setColour} />
        <button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
          Add tag
        </button>
        {create.error && <span className="status">{(create.error as Error).message}</span>}
      </div>

      {tags.isPending && <p className="status">Loading…</p>}
      {tags.error && <p className="status">Failed to load: {(tags.error as Error).message}</p>}
      {tags.data && tags.data.length === 0 && <p className="status">No tags yet.</p>}

      {tags.data && tags.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Tag</th>
              <th className="num">Activities</th>
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tags.data.map((tag) => (
              <TagRow key={tag.id} tag={tag} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
