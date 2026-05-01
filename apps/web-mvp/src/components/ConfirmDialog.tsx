import { useEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  /** Tone of the confirm action — "danger" turns it red. */
  tone?: 'default' | 'danger';
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Minimal accessible confirm modal. Renders nothing when closed so it
 * doesn't pile up DOM nodes. Closes on Escape, backdrop click, and
 * Cancel/Confirm buttons. Focuses Cancel on open so dangerous actions
 * aren't one-tap-Enter mistakes.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!props.open) return;
    cancelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onCancel]);

  if (!props.open) return null;

  const danger = props.tone === 'danger';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm"
      onClick={props.onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-graphite">{props.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-graphite-soft">{props.message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={props.onCancel}
            className="rounded-md border border-graphite-soft/30 bg-white px-4 py-2 text-sm font-medium text-graphite hover:bg-mist"
          >
            {props.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={props.onConfirm}
            className={
              'rounded-md px-4 py-2 text-sm font-medium text-white ' +
              (danger ? 'bg-red-600 hover:bg-red-700' : 'bg-graphite hover:bg-graphite-soft')
            }
          >
            {props.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
