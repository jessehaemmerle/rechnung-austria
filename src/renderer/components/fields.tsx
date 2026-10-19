import { useEffect, useState, type ReactNode } from 'react';
import { centsToDecimal, parseEuro } from '../../core/money';
import type { PaymentState } from '../../core/documents';

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Euro-Eingabe: zeigt "12,50", liefert Cent. Übernimmt den Wert erst beim Verlassen des Feldes. */
export function MoneyInput({ value, onChange, disabled, ariaLabel }: { value: number; onChange: (c: number) => void; disabled?: boolean; ariaLabel?: string }) {
  const fmt = (c: number) => centsToDecimal(c).replace('.', ',');
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  return (
    <input
      className="money"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        try {
          onChange(parseEuro(text || '0'));
        } catch {
          setText(fmt(value));
        }
      }}
    />
  );
}

const STATE_LABEL: Record<PaymentState, string> = {
  draft: 'Entwurf',
  open: 'Offen',
  partial: 'Teilbezahlt',
  paid: 'Bezahlt',
  overdue: 'Überfällig',
  cancelled: 'Storniert',
};

export function StateBadge({ state }: { state: PaymentState }) {
  return <span className={`badge ${state}`}>{STATE_LABEL[state]}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
