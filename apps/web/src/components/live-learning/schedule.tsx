import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { CLASS_PAGE } from '@minhaj/contracts/learning';

import { liveClassesReadRuntime } from '@/composition/learning-read';
import { teacherProfilesFor } from '@/composition/learning-teachers';
import { learnTrail } from '@/components/learning/parts';
import {
  courseHref,
  learnPageLinks,
  offsetHref,
  outlineLabel,
} from '@/components/learning/presentation';
import { Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { ClassTime, LiveFixtureNotice, TeacherName } from './parts';
import { liveSchedulePath, teacherDirectoryPath } from './presentation';

/**
 * `/learn/live` — the public schedule of upcoming classes (ROUTE_MAP.md §3.5;
 * DELIVERY_PLAN.md Phase 23).
 *
 * WHAT IS SHOWN IS WHAT IS PUBLIC: a class's Course, its teacher's PUBLIC name
 * where People publishes one, and its time in the zone it was scheduled in —
 * never a participant, a booking, a window or a meeting address. The page
 * reads through the public Learning root only, so it has no session, no
 * identity service and nothing that could read a cookie.
 *
 * HONEST WHILE SWITCHED OFF. With no activation in force the page says live
 * learning is not available, in words, rather than showing an empty week; a
 * fixture activation carries a visible banner. Both states are kept out of
 * indexing by the route's own metadata.
 */
export async function LiveSchedulePage({
  locale,
  offset,
}: {
  readonly locale: Locale;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'learnLive' });
  const learn = await getTranslations({ locale, namespace: 'learn' });
  const trail = await learnTrail(locale);
  const { mode, page } = await liveClassesReadRuntime().liveSchedule(offset);
  const profiles = await teacherProfilesFor(
    page.items.map((session) => session.teacherAccountId),
    locale,
  );
  const path = liveSchedulePath(locale);
  const links = learnPageLinks(offset, CLASS_PAGE, page.hasMore);

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <LiveFixtureNotice mode={mode} text={t('fixture')} />
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.learn, { text: t('title') }]}
        />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('zoneNote')}
          </p>
        </Prose>

        {mode === null ? (
          <div className="flex flex-col gap-3">
            <Alert tone="info">{t('unavailable.body')}</Alert>
            <p>
              <TextLink href={`/${locale}/learn/courses`}>
                {t('unavailable.browse')}
              </TextLink>
            </p>
          </div>
        ) : page.items.length === 0 ? (
          <EmptyState>{offset === 0 ? t('empty') : t('beyond')}</EmptyState>
        ) : (
          <ol aria-label={t('listLabel')} className="flex flex-col gap-4">
            {page.items.map((session) => {
              const label = outlineLabel(
                session.course.labels,
                locale,
                session.course.primaryLocale,
              );
              return (
                <Panel key={session.id} as="li">
                  <div className="flex min-w-0 flex-col gap-2">
                    <h2
                      className="text-lg font-semibold wrap-anywhere"
                      lang={label.locale}
                      dir={directionOf(label.locale)}
                    >
                      <TextLink href={courseHref(locale, session.course.slug)}>
                        {label.title}
                      </TextLink>
                    </h2>
                    <p className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('teacher')}
                      </span>
                      <TeacherName
                        profile={profiles.get(session.teacherAccountId)}
                        locale={locale}
                        fallback={t('teacherUnnamed')}
                      />
                    </p>
                    <p className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('starts')}
                      </span>
                      <ClassTime
                        instant={session.startsAt}
                        local={session.startsLocal}
                        timeZone={session.timeZone}
                        locale={locale}
                      />
                    </p>
                    <p className="flex flex-wrap gap-x-2 text-sm">
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('ends')}
                      </span>
                      <ClassTime
                        instant={session.endsAt}
                        local={session.endsLocal}
                        timeZone={session.timeZone}
                        locale={locale}
                      />
                    </p>
                    <p className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t('zone', { zone: session.timeZone })}
                    </p>
                  </div>
                </Panel>
              );
            })}
          </ol>
        )}

        {mode === null ? null : (
          <Pagination
            label={t('title')}
            previous={links.previous === null ? null : offsetHref(path, links.previous)}
            next={links.next === null ? null : offsetHref(path, links.next)}
            previousLabel={learn('previous')}
            nextLabel={learn('next')}
          />
        )}

        <p className="text-sm">
          <TextLink href={teacherDirectoryPath(locale)}>{t('findTeacher')}</TextLink>
        </p>
      </div>
    </Container>
  );
}
