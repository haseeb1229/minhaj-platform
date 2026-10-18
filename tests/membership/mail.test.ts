import { describe, expect, it } from 'vitest';

import { MEMBERSHIP_COMMUNICATION_PURPOSES } from '../../packages/contracts/src/membership/index.ts';
import { suppressionScopeOf } from '../../packages/contracts/src/platform/index.ts';
import {
  MEMBERSHIP_MAIL_LOCALES,
  membershipMailLocale,
  renderMembershipMail,
} from '../../apps/web/src/contexts/membership/index.ts';

/**
 * Phase 26 — Membership's service mail: every purpose authored in all three
 * locales, right-to-left where it must be, naming the type and linking the
 * person's own private Membership page — and nothing more: no payment
 * wording, no timetable or promised outcome, no address echoed, no link that
 * acts.
 */

const URL_FIXTURE = 'https://membership-proof.invalid/en/my/membership';
const RECIPIENT = 'person@membership-proof.invalid';
const TITLE = { text: 'NON_MEMBERSHIP_FIXTURE_TITLE', locale: 'en' } as const;

const render = (
  purpose: (typeof MEMBERSHIP_COMMUNICATION_PURPOSES)[number],
  locale: string,
  overrides: Partial<Parameters<typeof renderMembershipMail>[0]> = {},
) =>
  renderMembershipMail({
    purpose,
    locale,
    recipient: RECIPIENT,
    typeTitle: TITLE,
    membershipUrl: URL_FIXTURE,
    ...overrides,
  });

const every = () =>
  MEMBERSHIP_COMMUNICATION_PURPOSES.flatMap((purpose) =>
    MEMBERSHIP_MAIL_LOCALES.map((locale) => ({
      purpose,
      locale,
      message: render(purpose, locale, { typeTitle: { text: TITLE.text, locale } }),
    })),
  );

describe('Membership mail', () => {
  it('is authored in exactly the three interface locales', () => {
    expect([...MEMBERSHIP_MAIL_LOCALES]).toEqual(['en', 'ur', 'ar']);
    expect(membershipMailLocale('ur')).toBe('ur');
    expect(membershipMailLocale('ar')).toBe('ar');
    expect(membershipMailLocale('fr')).toBe('en');
    expect(membershipMailLocale('')).toBe('en');
  });

  it('renders every purpose in every locale, with direction, the type and the link', () => {
    for (const { purpose, locale, message } of every()) {
      const name = `${purpose} ${locale}`;
      expect(message.subject.length, name).toBeGreaterThan(0);
      expect(message.recipient, name).toBe(RECIPIENT);
      expect(message.html, name).toContain(
        `<html lang="${locale}" dir="${locale === 'en' ? 'ltr' : 'rtl'}">`,
      );
      expect(message.html, name).toContain(`<span>${TITLE.text}</span>`);
      expect(message.text, name).toContain(TITLE.text);
      expect(message.html, name).toContain(`href="${URL_FIXTURE}"`);
      expect(message.text, name).toContain(URL_FIXTURE);
    }
  });

  it('writes Urdu and Arabic in their own scripts, not English', () => {
    for (const { locale, message } of every()) {
      if (locale === 'en') continue;
      // Urdu and Arabic both write in the Arabic script block.
      expect(message.subject).toMatch(/[؀-ۿ]/u);
      expect(message.subject).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('says something different for each purpose', () => {
    for (const locale of MEMBERSHIP_MAIL_LOCALES) {
      const subjects = MEMBERSHIP_COMMUNICATION_PURPOSES.map(
        (purpose) => render(purpose, locale).subject,
      );
      expect(new Set(subjects).size, locale).toBe(subjects.length);
    }
  });

  it('carries no payment wording, no timetable and no promised outcome', () => {
    for (const { purpose, locale, message } of every()) {
      const all = `${message.subject}\n${message.html}\n${message.text}`;
      expect(all, `${purpose} ${locale}`).not.toMatch(
        /fee|payment|donat|price|invoice/iu,
      );
      if (locale === 'en')
        expect(message.text, purpose).not.toMatch(
          /\b(?:within|days?|hours?|weeks?|guarantee\w*|promise\w*|soon|shortly)\b/iu,
        );
    }
  });

  it('never echoes the address and offers no link that acts', () => {
    for (const { purpose, locale, message } of every()) {
      const name = `${purpose} ${locale}`;
      expect(message.html, name).not.toContain(RECIPIENT);
      expect(message.text, name).not.toContain(RECIPIENT);
      expect(
        [...message.html.matchAll(/href="([^"]*)"/gu)].map((m) => m[1]),
        name,
      ).toEqual([URL_FIXTURE]);
      expect(message.html, name).not.toMatch(/token|confirm=|action=/iu);
    }
  });

  it('escapes the type title and the link in HTML', () => {
    const message = render('membership.application.submitted', 'en', {
      typeTitle: { text: '<script>alert("x")</script> & co', locale: 'en' },
      membershipUrl: 'https://membership-proof.invalid/en/my/membership?a=1&b=2',
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
    );
    expect(message.html).toContain('membership?a=1&amp;b=2');
  });

  it('marks a title written in another locale with its own language and direction', () => {
    const urdu = render('membership.closed', 'ur', {
      typeTitle: { text: 'NON_MEMBERSHIP_FIXTURE_EN_TITLE', locale: 'en' },
    });
    expect(urdu.html).toContain(
      '<span lang="en" dir="ltr">NON_MEMBERSHIP_FIXTURE_EN_TITLE</span>',
    );
    const english = render('membership.closed', 'en', {
      typeTitle: { text: 'NON_MEMBERSHIP_FIXTURE_AR_TITLE', locale: 'ar' },
    });
    expect(english.html).toContain(
      '<span lang="ar" dir="rtl">NON_MEMBERSHIP_FIXTURE_AR_TITLE</span>',
    );
  });

  it('falls back to English for an unknown locale', () => {
    const message = render('membership.application.rejected', 'fr');
    expect(message.html).toContain('<html lang="en" dir="ltr">');
  });
});

describe('Membership mail is transactional, never marketing', () => {
  it('is suppressed only in the transactional scope — a newsletter complaint never reaches it', () => {
    // A complaint about a Membership message, or a bounce, is about account
    // service mail; only a complaint about a newsletter message is marketing,
    // so no newsletter unsubscribe or complaint can silence a decision.
    for (const purpose of MEMBERSHIP_COMMUNICATION_PURPOSES) {
      expect(suppressionScopeOf('complaint', purpose), purpose).toBe('transactional');
      expect(suppressionScopeOf('bounce', purpose), purpose).toBe('transactional');
    }
    expect(suppressionScopeOf('complaint', 'newsletter.confirmation')).toBe('marketing');
  });
});
