import { useState, type ChangeEvent } from 'react';

export interface KeyFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
}

export function KeyField({ label, value, onChange, placeholder, helperText }: KeyFieldProps) {
  const [show, setShow] = useState(false);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    onChange(e.target.value);
  }

  return (
    <label className="block">
      <span className="block text-sm font-medium text-graphite">{label}</span>
      <div className="mt-1 flex gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-sm font-mono text-graphite placeholder:text-graphite-soft/50 focus:border-graphite focus:outline-none focus:ring-1 focus:ring-graphite"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-md border border-graphite-soft/30 bg-white px-3 py-2 text-xs font-medium text-graphite-soft hover:bg-mist"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
      {helperText ? <p className="mt-1 text-xs text-graphite-soft">{helperText}</p> : null}
    </label>
  );
}
