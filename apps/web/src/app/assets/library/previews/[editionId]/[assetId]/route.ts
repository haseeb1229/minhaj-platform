import { requirePermittedAction } from '@/composition/authorization';
import { libraryPreviewAssetPolicy } from '@/composition/library';
import { refuseAsset, serveLibraryAsset } from '../../../serve';

/**
 * `/assets/library/previews/{editionId}/{assetId}` — an ADMINISTRATIVE preview of an
 * Edition's file (§16, §28).
 *
 * WHY IT EXISTS. Without it, the only way for an operator to confirm they attached
 * the right PDF to the right Edition would be to publish the Edition and look — a
 * review step performed in public. This route lets them look first.
 *
 * WHY IT IS A SEPARATE ROUTE FROM THE PUBLIC ONE. Privileged access is a DIFFERENT
 * authority from ordinary Library reading, so it is a different address with a
 * different policy, and the public route cannot reach this one's decision even by
 * accident: the public handler never constructs a policy that accepts the `preview`
 * purpose, and this handler never constructs one that accepts `read` or `download`.
 * Keeping them apart is also what keeps Identity out of the public byte path's
 * module graph entirely (§36).
 *
 * IT IS NOT "AN ADMINISTRATOR MAY DOWNLOAD ANYTHING" (§16). Three independent
 * conditions, and all three must hold:
 *
 *   1. a LIVE `library.administer` permission, re-read through the authorisation
 *      service on this request. Not a role name, not a profile flag, not a
 *      permission the session was issued with an hour ago — so a revoked Library
 *      role refuses the next request (SECURITY_BASELINE.md §3.4 rule 2);
 *   2. the asset is ALREADY RECORDED against this exact Edition as its readable or
 *      download file. An arbitrary asset identifier is refused, so this is not a
 *      general-purpose file reader for anyone holding the permission;
 *   3. Storage's own technical decision. A quarantined or infected asset is refused
 *      here exactly as it is publicly — which is the case most worth being sure
 *      about, because an operator checking a fresh upload is precisely who would
 *      otherwise be handed an unscanned file (§45).
 *
 * `requirePermittedAction` RATHER THAN A STEP-UP. Looking at a file that is already
 * attached to a record the caller may already edit changes nothing about privilege,
 * credentials or content. Requiring a second factor and a step-up grant to read a
 * page's own attachment would make one routine check cost two proofs, which is how
 * people end up holding an elevation open all day (SECURITY_BASELINE.md §8.1).
 * Everything that CHANGES a record still goes through the Library actions.
 *
 * ONE REFUSAL FOR EVERY CAUSE. No session, no permission, wrong Edition, unrelated
 * asset, quarantined bytes and a missing record all produce the same 404 — so this
 * route discloses neither which assets exist nor which editions do.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ readonly editionId: string; readonly assetId: string }>;
  },
): Promise<Response> {
  const { editionId, assetId } = await params;

  /**
   * THE LOCALE IS NOT IN THIS PATH, so a locale has to be supplied to the session
   * resolver. `en` is passed because the value is used only to build the
   * sign-in redirect a PAGE would follow — and this is not a page: a refusal here
   * is a 404 with no body, never a redirect. Nothing about the decision depends on
   * it.
   */
  const permitted = await requirePermittedAction('en', 'library.administer');
  if (permitted.state === 'denied') return refuseAsset();

  return serveLibraryAsset(
    assetId,
    libraryPreviewAssetPolicy(
      { editionId, assetId, purpose: 'preview' },
      permitted.session.account.id,
    ),
    'inline',
  );
}
