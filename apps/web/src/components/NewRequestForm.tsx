import { CreateRequestBody, PRIORITIES, REQUEST_TYPES, type Money, type Priority, type RequestType } from '@approvals/contracts';
import { useState, type FormEvent, type ReactNode } from 'react';
import type { FieldError } from '../api';
import { minorDigits, PRIORITY_LABELS, TYPE_LABELS } from '../format';
import { useCreateRequest } from '../queries';
import { ErrorMessage } from './ErrorMessage';

type Props = { onCreated: (id: string) => void; onCancel: () => void };

export function NewRequestForm({ onCreated, onCancel }: Props) {
  const create = useCreateRequest();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<RequestType>('purchase');
  const [priority, setPriority] = useState<Priority>('normal');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('RON');
  const [tags, setTags] = useState('');
  const [errors, setErrors] = useState<FieldError[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const money = toMoney(amount, currency);
    if (money === 'invalid') {
      setErrors([{ path: 'amount', message: 'Enter an amount, for example 1250.50' }]);
      return;
    }

    // The same schema the API validates with, so the form catches mistakes before the round trip.
    const parsed = CreateRequestBody.safeParse({
      title,
      type,
      priority,
      description,
      amount: money,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    });
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })));
      return;
    }
    setErrors([]);
    create.mutate(parsed.data, { onSuccess: (response) => onCreated(response.request.id) });
  }

  // Tag errors come back per tag (tags.2), but the form has one tags field to show them under.
  const errorFor = (path: string) =>
    errors.find((error) => error.path === path || (path === 'tags' && error.path.startsWith('tags.')))?.message;

  return (
    <form className="card new-request" onSubmit={submit} aria-labelledby="new-request-title" noValidate>
      <h2 id="new-request-title">New request</h2>

      <Field id="title" label="Title" error={errorFor('title')}>
        <input id="title" {...describedBy('title', errorFor('title'))} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <div className="field-row">
        <Field id="type" label="Type">
          <select id="type" value={type} onChange={(e) => setType(e.target.value as RequestType)}>
            {REQUEST_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field id="priority" label="Priority">
          <select id="priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field id="description" label="Description" error={errorFor('description')}>
        <textarea id="description" {...describedBy('description', errorFor('description'))} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>

      <div className="field-row">
        <Field id="amount" label="Amount (optional)" error={errorFor('amount')}>
          <input id="amount" {...describedBy('amount', errorFor('amount'))} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field id="currency" label="Currency" error={errorFor('amount.currency')}>
          <input id="currency" {...describedBy('currency', errorFor('amount.currency'))} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </Field>
      </div>

      <Field id="tags" label="Tags, separated by commas" error={errorFor('tags')}>
        <input id="tags" {...describedBy('tags', errorFor('tags'))} placeholder="finance, q4" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>

      <ErrorMessage error={create.error} />

      <div className="actions">
        <button type="submit" className="button primary" disabled={create.isPending}>
          Create request
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type FieldProps = { id: string; label: string; error?: string; children: ReactNode };

function Field({ id, label, error, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}

// Marks an input invalid and points it at the error Field renders under it, so screen readers read the
// error together with the field (the same pattern as DecisionForm).
function describedBy(id: string, error: string | undefined) {
  return { 'aria-invalid': error !== undefined, 'aria-describedby': error ? `${id}-error` : undefined };
}

// The form takes major units ("1250.50") and the API wants minor units (125050), converted per currency.
function toMoney(amount: string, currency: string): Money | undefined | 'invalid' {
  if (amount.trim() === '') return undefined;
  const value = Number(amount.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  const digits = /^[A-Z]{3}$/.test(currency) ? minorDigits(currency) : 2;
  return { amountMinor: Math.round(value * 10 ** digits), currency };
}
