import { describe, expect, it } from 'vitest';

import { stepUpAnchor } from '../../apps/web/src/components/ui/step-up-event.ts';
import { safeStepUpReturnTo } from '../../apps/web/src/composition/return-to.ts';

/**
 * R2 (audit F35) — WHERE A STEP-UP CONFIRMATION RESUMES.
 *
 * After a grant is earned the person goes back to the page they were working
 * on. The destination is bound to the grant's PURPOSE: only a page whose
 * changes that purpose authorises, same-origin, with no way to smuggle a
 * network reference, traversal or header-splitting character through. Every
 * refusal is `null` — the person stays where they are; a refusal never turns
 * into a redirect somewhere else.
 */
const DONATION = '0b6c1f8e-3c1a-4c55-9a77-2b1d6c2f9e10';
const MANIFEST = '6f0e2a9d-8f43-4d7c-a1c2-3b4e5f607182';

describe('a step-up resumes on the page it was earned for', () => {
  it('returns to the purpose’s own pages, in the reader’s locale, at the prompt', () => {
    expect(safeStepUpReturnTo('/admin/identity/users', 'account-administration')).toBe(
      '/admin/identity/users#step-up-account-administration',
    );
    expect(
      safeStepUpReturnTo('/ur/admin/identity/roles', 'privilege-administration'),
    ).toBe('/ur/admin/identity/roles#step-up-privilege-administration');
    expect(safeStepUpReturnTo(`/ar/admin/donations/${DONATION}`, 'donation-refund')).toBe(
      `/ar/admin/donations/${DONATION}#step-up-donation-refund`,
    );
    expect(
      safeStepUpReturnTo(
        `/admin/migration/manifests/${MANIFEST}`,
        'migration-publication',
      ),
    ).toBe(`/admin/migration/manifests/${MANIFEST}#step-up-migration-publication`);
    expect(safeStepUpReturnTo('/admin/quran/ayat/2/255', 'quran-canonical-edit')).toBe(
      '/admin/quran/ayat/2/255#step-up-quran-canonical-edit',
    );
    expect(stepUpAnchor('donation-refund')).toBe('step-up-donation-refund');
  });

  it('canonicalises a legacy English prefix', () => {
    expect(safeStepUpReturnTo('/en/admin/identity/users', 'account-administration')).toBe(
      '/admin/identity/users#step-up-account-administration',
    );
  });

  it('keeps the page’s own filters and never a fragment it was sent', () => {
    expect(
      safeStepUpReturnTo(
        '/admin/identity/users?q=ahmad&status=active&page=2#accounts',
        'account-administration',
      ),
    ).toBe(
      '/admin/identity/users?q=ahmad&status=active&page=2#step-up-account-administration',
    );
    expect(
      safeStepUpReturnTo('/admin/identity/users#<script>', 'account-administration'),
    ).toBe('/admin/identity/users#step-up-account-administration');
  });
});

describe('a step-up never resumes anywhere else', () => {
  it('refuses another purpose’s page', () => {
    // A grant to change account status does not reopen role administration…
    expect(
      safeStepUpReturnTo('/admin/identity/roles', 'account-administration'),
    ).toBeNull();
    // …a refund grant names no manifest…
    expect(
      safeStepUpReturnTo(`/admin/migration/manifests/${MANIFEST}`, 'donation-refund'),
    ).toBeNull();
    // …and a personal second-factor grant resumes nowhere in the administration.
    expect(safeStepUpReturnTo('/admin/identity/users', 'second-factor')).toBeNull();
  });

  it('refuses pages outside the administration and shapes it does not name', () => {
    for (const candidate of [
      '/my',
      '/admin',
      '/admin/identity/users/extra',
      '/admin/donations/not-an-id',
      `/admin/donations/${DONATION.toUpperCase()}`,
      '/admin/quran/ayat/0/1',
    ]) {
      expect(safeStepUpReturnTo(candidate, 'donation-refund'), candidate).toBeNull();
      expect(
        safeStepUpReturnTo(candidate, 'account-administration'),
        candidate,
      ).toBeNull();
    }
  });

  it('refuses every open-redirect shape', () => {
    for (const candidate of [
      'https://evil.example/admin/identity/users',
      '//evil.example/admin/identity/users',
      '/\\evil.example/admin/identity/users',
      '/%5Cevil.example/admin/identity/users',
      '/%2F%2Fevil.example/admin/identity/users',
      'javascript:alert(1)//admin/identity/users',
      'admin/identity/users',
      '/admin/identity/../identity/users',
      '/admin/identity/%2e%2e/identity/users',
      '/admin/identity/users?next=//evil.example',
      '/admin/identity/users%0d%0aSet-Cookie:x',
      '/admin/identity/users#%0aX',
      '/admin/identity/users%',
      '',
      null,
      `/admin/identity/users?${'a'.repeat(600)}`,
    ]) {
      expect(
        safeStepUpReturnTo(candidate, 'account-administration'),
        String(candidate),
      ).toBeNull();
    }
  });
});
