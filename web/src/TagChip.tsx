import type { Tag } from '@fitness/shared';

interface Props {
  tag: Pick<Tag, 'name' | 'colour'>;
  /** Renders as a toggle button when set; a plain label otherwise. */
  onClick?: () => void;
  selected?: boolean;
  title?: string;
}

/**
 * One tag, as a coloured pill. The colour is a small dot rather than the whole
 * chip's background so user-chosen colours can't wreck text contrast.
 */
export default function TagChip({ tag, onClick, selected, title }: Props) {
  const dot = <span className="tag-dot" style={tag.colour ? { background: tag.colour } : undefined} />;

  if (!onClick) {
    return (
      <span className="tag-chip" title={title ?? tag.name}>
        {dot}
        {tag.name}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`tag-chip${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      title={title ?? tag.name}
      onClick={onClick}
    >
      {dot}
      {tag.name}
    </button>
  );
}
