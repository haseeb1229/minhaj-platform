import type { Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { ActionLink, Icon, type IconName } from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE MY MINHAJ INVITATION (R2) — described, never personalised.
 *
 * It says what an account adds and links to it. It does not say whether
 * anybody is signed in: this page is one document served to every visitor,
 * and a greeting here would be somebody else's (ARCHITECTURE.md §8.1). And it
 * says plainly that nothing above needs one.
 */
const BENEFITS: readonly {
  readonly key: 'save' | 'continue' | 'learn';
  readonly icon: IconName;
}[] = [
  { key: 'save', icon: 'bookmark' },
  { key: 'continue', icon: 'book' },
  { key: 'learn', icon: 'calendar' },
];

export async function MyMinhajInvitation({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <HomeSection id="home-account" band="accent">
      <div className="grid grid-cols-1 items-center gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <h2 id="home-account" className="text-title font-semibold text-balance">
            {t('home.account.heading')}
          </h2>
          <p className="max-w-[var(--measure-prose)] text-lede text-foreground-muted">
            {t('home.account.body')}
          </p>
          <div>
            <ActionLink href={pathFor(locale, requireRoute('my-minhaj'))}>
              {t('home.account.action')}
            </ActionLink>
          </div>
        </div>
        <ul className="m-0 flex list-none flex-col gap-5 p-0">
          {BENEFITS.map((benefit) => (
            <li key={benefit.key} className="flex items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full border border-accent-rule bg-surface-raised text-accent">
                <Icon name={benefit.icon} />
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-semibold">
                  {t(`home.account.benefits.${benefit.key}.title`)}
                </span>
                <span className="text-sm text-foreground-muted">
                  {t(`home.account.benefits.${benefit.key}.body`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </HomeSection>
  );
}
