'use client';

import { useState } from 'react';

import {
  ASSET_LICENCES,
  ASSET_VISIBILITIES,
  type AssetLicence,
  type AssetVisibility,
} from '@minhaj/contracts/migration';

import { Field, Select } from '@/components/ui';

/**
 * The licence and visibility of ONE acquisition's rights decision.
 *
 * `public-eligible` is selectable only while the licence is
 * `organisation-owned` or `licensed`; choosing any other licence returns the
 * visibility to `restricted`. That is a kindness, not the control: without
 * JavaScript the form still submits, and the service and the database CHECK
 * both refuse public eligibility for anything else.
 */
const PUBLIC_LICENCES: ReadonlySet<AssetLicence> = new Set([
  'organisation-owned',
  'licensed',
]);

export function RightsFields({
  prefix,
  licence,
  visibility,
  labels,
}: {
  readonly prefix: string;
  readonly licence: AssetLicence;
  readonly visibility: AssetVisibility;
  readonly labels: {
    readonly licence: string;
    readonly visibility: string;
    readonly visibilityHelp: string;
    readonly licences: Readonly<Record<AssetLicence, string>>;
    readonly visibilities: Readonly<Record<AssetVisibility, string>>;
  };
}) {
  const [chosenLicence, setLicence] = useState<AssetLicence>(licence);
  const [chosenVisibility, setVisibility] = useState<AssetVisibility>(visibility);
  const eligible = PUBLIC_LICENCES.has(chosenLicence);

  return (
    <>
      <Field id={`${prefix}-licence`} label={labels.licence}>
        {(props) => (
          <Select
            {...props}
            name="licence"
            value={chosenLicence}
            onChange={(event) => {
              const next = event.target.value as AssetLicence;
              setLicence(next);
              if (!PUBLIC_LICENCES.has(next)) setVisibility('restricted');
            }}
          >
            {ASSET_LICENCES.map((value) => (
              <option key={value} value={value}>
                {labels.licences[value]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id={`${prefix}-visibility`}
        label={labels.visibility}
        help={labels.visibilityHelp}
      >
        {(props) => (
          <Select
            {...props}
            name="visibility"
            value={chosenVisibility}
            onChange={(event) => setVisibility(event.target.value as AssetVisibility)}
          >
            {ASSET_VISIBILITIES.map((value) => (
              <option
                key={value}
                value={value}
                disabled={value === 'public-eligible' && !eligible}
              >
                {labels.visibilities[value]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}
