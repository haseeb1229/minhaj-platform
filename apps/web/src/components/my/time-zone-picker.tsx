'use client';

import { useId, useState } from 'react';

import { filterTimeZones, type TimeZoneChoice } from './time-zones';

/**
 * THE ACCOUNT'S TIME ZONE, CHOSEN FROM A LIST (R2, audit F37) — not typed.
 *
 * A NATIVE SELECT CARRIES THE VALUE. It is server-rendered with every IANA zone
 * the runtime knows, grouped by region, so the form works with no JavaScript
 * and can only submit a zone the server's own check accepts. The island adds
 * two conveniences on top: a search box that narrows the list as the person
 * types ("karachi", "GMT+5"), and a button that picks the zone this device
 * reports. Neither submits anything; the server validates whatever is sent.
 */
export function TimeZonePicker({
  field,
  choices,
  defaultValue,
  labels,
}: {
  /** The props `Field` gives its control: id and description wiring. */
  readonly field: {
    readonly id: string;
    readonly 'aria-describedby': string | undefined;
    readonly 'aria-invalid': boolean | undefined;
  };
  readonly choices: readonly TimeZoneChoice[];
  readonly defaultValue: string;
  readonly labels: {
    readonly search: string;
    readonly device: string;
    /** "Matching time zones: {count}" — the count is filled in here. */
    readonly matches: string;
  };
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [value, setValue] = useState(defaultValue);
  const shown = filterTimeZones(choices, query, value);
  const regions = [...new Set(shown.map((choice) => choice.region))];

  function chooseDevice() {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (choices.some((choice) => choice.id === device)) {
      setValue(device);
      setQuery('');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label htmlFor={searchId} className="sr-only">
          {labels.search}
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          aria-controls={field.id}
          autoComplete="off"
          className="min-h-11 min-w-0 flex-1 rounded-control border border-border-strong bg-surface-raised px-3 text-sm"
        />
        <button
          type="button"
          onClick={chooseDevice}
          className="inline-flex min-h-11 items-center rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-medium transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border"
        >
          {labels.device}
        </button>
      </div>
      <select
        {...field}
        name="timezone"
        required
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-h-11 w-full rounded-control border border-border-strong bg-surface-raised px-3 text-sm"
      >
        {regions.map((region) => (
          <optgroup key={region} label={region}>
            {shown
              .filter((choice) => choice.region === region)
              .map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {`${choice.place} (${choice.offset})`}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <p role="status" className="text-caption text-foreground-muted">
        {query === '' ? null : labels.matches.replace('{count}', String(shown.length))}
      </p>
    </div>
  );
}
