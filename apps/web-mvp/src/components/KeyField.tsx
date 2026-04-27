import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { maskKeyForDisplay } from '../lib/redact';

export interface KeyFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  /**
   * The persisted value the field should consider "secret" — when this is
   * non-empty AND matches the current value, the field renders as a masked
   * preview (e.g. `sk-•••••last4`) rather than the raw key. Editing
   * replaces the masked display.
   */
  savedValue?: string;
}

export function KeyField({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  savedValue,
}: KeyFieldProps) {
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset to masked-display mode whenever the saved value changes (e.g. on
  // re-mount after Save). The user can click "Replace" to enter editing.
  useEffect(() => {
    setEditing(false);
    setShow(false);
  }, [savedValue]);

  const isMaskedDisplay = !editing && Boolean(savedValue) && value === savedValue && !show;

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  function startEditing() {
    setEditing(true);
    onChange('');
    // Focus the input after the next render so the user can type immediately
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <label className="block">
      <span className="block text-sm font-medium text-graphite">{label}</span>
      <div className="mt-1 flex gap-2">
        {isMaskedDisplay ? (
          <input
            type="text"
            value={maskKeyForDisplay(value)}
            readOnly
            onFocus={(e) => e.target.blur()}
            className="flex-1 rounded-md border border-graphite-soft/30 bg-mist px-3 py-2 text-sm font-mono text-graphite-soft cursor-default"
            tabIndex={-1}
            aria-label={`${label} (masked, saved)`}
          />
        ) : (
          <input
            ref={inputRef}
            type={show ? 'text' : 'password'}
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            className="flex-1 rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm font-mono text-graphite placeholder:text-graphite-soft/50 focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
            autoComplete="off"
            spellCheck={false}
            aria-label={label}
          />
        )}
        {isMaskedDisplay ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-xs font-medium text-graphite-soft hover:bg-mist"
          >
            Replace
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-xs font-medium text-graphite-soft hover:bg-mist"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {helperText ? <p className="mt-1 text-xs text-graphite-soft">{helperText}</p> : null}
    </label>
  );
}
