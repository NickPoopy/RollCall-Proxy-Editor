import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onCommit: (v: string) => void;
  /** Return an error message to show the field as invalid. */
  check?: (v: string) => string | null;
};

/**
 * A text input that commits on Enter or blur rather than on every keystroke,
 * so each edit is one undo step. Escape reverts.
 */
export function CommitInput({ value, onCommit, check, className, ...rest }: Props) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = check ? check(draft) : null;

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <input
      {...rest}
      className={`${className ?? ''}${error ? ' invalid' : ''}`}
      title={error ?? rest.title}
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
        }
      }}
    />
  );
}
