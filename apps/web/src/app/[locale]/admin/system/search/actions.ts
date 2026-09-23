'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';

import { localeSchema } from '@minhaj/contracts/identity';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { recordSearchOperation, searchRuntime } from '@/composition/search';

import type { AdminActionState } from '../../actions';

/**
 * The search operations — Class-A browser mutations (SECURITY_BASELINE.md §7.1).
 *
 * Server Actions only, so each carries the framework's Origin and CSRF
 * protections and none is reachable by GET. Each re-checks `search.operate`
 * independently of the page that rendered it, because the minutes between a
 * render and a submit are long enough for a grant to be revoked (§3.4 rule 2).
 *
 * NONE OF THEM CHANGES CONTENT. They re-project what the owners ALREADY
 * publish, which is why they need a permission and not a step-up: nothing here
 * can publish, withdraw or alter a record (§8.1 lists what step-up guards).
 *
 * AUDITED ANYWAY, because an operator forcing a full rebuild of a public index
 * is an operational act somebody may need to account for later (§13).
 *
 * REBUILD AND RECONCILE RUN AFTER THE RESPONSE. Each enumerates every owner's
 * public inventory in bounded pages; holding the operator's request open for
 * that would tie a browser tab to the size of the corpus. The requests they
 * record are durable, so an interrupted run is resumed by running it again.
 */

function report(operation: string): void {
  appLogger().error({ operation }, 'Search operation failed.');
}

async function operate(
  form: FormData,
  action: 'retry' | 'reconcile' | 'rebuild',
): Promise<AdminActionState> {
  const parsed = localeSchema.safeParse(form.get('locale'));
  const locale = parsed.success ? parsed.data : 'en';

  const gate = await requirePermittedAction(locale, 'search.operate');
  if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

  const accountId = gate.session.account.id;
  const search = searchRuntime();

  try {
    await recordSearchOperation(action, accountId);

    if (action === 'retry') {
      await search.retryFailed();
      after(async () => {
        try {
          await search.processDue({ budgetMs: 10_000 });
        } catch {
          report('search.index.retry');
        }
      });
    } else {
      after(async () => {
        try {
          if (action === 'rebuild') await search.rebuild();
          else await search.reconcile();
          await search.processDue({ budgetMs: 20_000 });
        } catch {
          // The requests already recorded are durable; the sweep continues them.
          report(`search.index.${action}`);
        }
      });
    }
  } catch {
    report(`search.index.${action}`);
    return { status: 'error', failure: 'unavailable' };
  }

  revalidatePath(`/${locale}/admin/system/search`);
  return { status: 'success' };
}

export async function retrySearchIndexingAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  return operate(form, 'retry');
}

export async function reconcileSearchIndexAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  return operate(form, 'reconcile');
}

export async function rebuildSearchIndexAction(
  _previous: AdminActionState,
  form: FormData,
): Promise<AdminActionState> {
  return operate(form, 'rebuild');
}
