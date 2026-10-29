import 'server-only';

/**
 * Serving an Editorial lead image (Phase 30-R) — EXACTLY the Photo serving
 * semantics, reused rather than restated: both owners must allow, `private,
 * no-cache` with the stored checksum as a strong validator (a 304 only after
 * both allowed), `nosniff`, same-origin resource policy, `noindex`, and ONE
 * identical 404 for every refusal, so the route can neither enumerate assets
 * nor watch one move through custody. A preview is `private, no-store`.
 */
export {
  refuseMediaBytes as refuseEditorialBytes,
  servePhoto as serveLeadImage,
} from '../media/serve';
