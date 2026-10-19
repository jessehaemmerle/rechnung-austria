import { useCallback, useState } from 'react';

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'error';
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 3500);
  }, []);
  return { toasts, notify };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.msg.split('\n').map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ))}
    </div>
  );
}
