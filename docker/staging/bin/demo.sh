#!/usr/bin/env bash
# =============================================================================
# demo.sh — the staging demonstration data (Rebaseline R2)
# =============================================================================
#
#   demo.sh seed   --operator <accountId> [--session <sessionId>]
#   demo.sh status
#   demo.sh reset  --operator <accountId>
#
# Owner decision 2026-11-06 (OPEN_DECISIONS.md §4.2): the pre-adoption,
# password-protected, noindex staging environment may hold clearly SYNTHETIC
# demo personas and their private journeys — classes, messages, a membership,
# fixture donations — as ENVIRONMENT DATA an operator puts there. It is never
# an application mode, and production never runs this.
#
# BEFORE ANYTHING: the staging host proof (lib.sh), and the deployed web
# service must be the non-indexable staging build. The command itself refuses
# again unless it is told, exactly, that this deployment is staging and not
# indexable.
#
# CREDENTIALS. The three persona passwords are generated HERE, once, from the
# kernel CSPRNG, into $DEMO_CREDENTIALS (root:root, mode 600) and reused on
# every later run. They reach the command on standard input only — never an
# argument, an environment variable or the output. Nothing prints them; the
# owner reads that file over SSH (`sudo cat`).
#
# PRIVILEGE. `seed` makes the demo teaching role and grants it to the demo
# teacher through Identity's audited administration, as the operator: before
# the FIRST seed (or after a reset), the operator signs in as a staging
# administrator and confirms a privilege-administration step-up on the admin
# roles screen (it lasts five minutes). Later seeds need no step-up.
#
# The last output line is the command's JSON summary: identifiers and counts.
# =============================================================================

. "$(dirname "$(readlink -f "$0")")/lib.sh"

readonly DEMO_CREDENTIALS=/etc/minhaj/secrets/demo-accounts.txt
readonly DEMO_PERSONAS='student:amina.student@demo.minhaj.invalid teacher:yusuf.teacher@demo.minhaj.invalid member:bilal.member@demo.minhaj.invalid'

# The running web service must be the deployment's non-indexable build.
assert_not_indexable() {
  local dir value
  dir="$(current_release_dir)"
  value="$(release_compose "$dir" exec -T web printenv PUBLIC_INDEXING_ENABLED 2> /dev/null | tr -d '\r')" \
    || die "the web service is not running; deploy staging first"
  [ "$value" = false ] || die "the deployed web service is not explicitly non-indexable"
}

# Creates the credentials file once (root-only), never printing a password.
ensure_credentials() {
  [ -f "$DEMO_CREDENTIALS" ] && { assert_root_only "$DEMO_CREDENTIALS"; return 0; }
  local file entry key email password
  file="$(mktemp "$SECRETS_DIR/.demo-accounts.XXXXXX")"
  chmod 600 "$file"
  {
    printf '# One Minhaj staging demo accounts - SYNTHETIC personas, staging only.\n'
    printf '# persona email password\n'
    for entry in $DEMO_PERSONAS; do
      key="${entry%%:*}"
      email="${entry#*:}"
      # 32 URL-safe characters from 24 CSPRNG bytes.
      password="$(head -c 24 /dev/urandom | base64 | tr '+/' '-_')"
      printf '%s %s %s\n' "$key" "$email" "$password"
    done
  } > "$file"
  unset password
  mv "$file" "$DEMO_CREDENTIALS"
  assert_root_only "$DEMO_CREDENTIALS"
  log "demo credentials written to $DEMO_CREDENTIALS (root-only; not printed)"
}

# One demo command in the exact-SHA operations image, declared staging and
# non-indexable; extra arguments are validated strictly by the command itself.
demo_ops() {
  release_compose "$(current_release_dir)" --profile ops run --rm --no-deps -T \
    -e PUBLIC_INDEXING_ENABLED=false ops \
    packages/database/scripts/staging-demo.ts "$@"
}

staging_preflight
host_lock
case "${1:-}" in
  seed)
    assert_not_indexable
    ensure_credentials
    demo_ops "$@" < "$DEMO_CREDENTIALS" | tail -n 1 | jq -c . \
      || die "staging-demo did not end with a JSON summary"
    ;;
  status)
    demo_ops status < /dev/null | tail -n 1 | jq -c . \
      || die "staging-demo did not end with a JSON summary"
    ;;
  reset)
    assert_not_indexable
    demo_ops "$@" < /dev/null | tail -n 1 | jq -c . \
      || die "staging-demo did not end with a JSON summary"
    ;;
  *) die "usage: demo.sh seed --operator <accountId> [--session <sessionId>] | status | reset --operator <accountId>" ;;
esac
