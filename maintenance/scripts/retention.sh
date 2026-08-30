#!/usr/bin/env bash
# Deterministic current+previous Docker image retention for the shared
# production VPS (re-raise, poker-app, poker-clock, spb-poker).
#
# WHY THIS EXISTS
# `docker image prune -f` (used by every project's maintenance.yml) only
# removes dangling (untagged) images. It never touches tagged
# `<repo>:<commit-sha>` deployment images, because every deploy.yml on this
# box pulls a new SHA tag and simply leaves the old one sitting there,
# still tagged, forever. That is why the VPS accumulates dozens of old
# images per app even though scheduled maintenance runs weekly.
#
# WHAT THIS SCRIPT DOES
# CURRENT is read from the ACTUALLY RUNNING container (ground truth, never
# guessed). PREVIOUS is read from an explicit, persistent marker --
# `<app_repo>:rollback-previous`, a purely local Docker tag maintained by
# deploy.yml -- NOT inferred from build timestamps. Build order is not
# production order: a rollback, a redeploy of an older SHA, a pull that
# never became current, or an out-of-order manual deploy would all make a
# timestamp-based guess wrong. deploy.yml retags `rollback-previous` to
# point at the image that was actually running and healthy immediately
# before a deploy, and ONLY after the NEW image has itself passed
# health+smoke -- never on a failed/rolled-back deploy (see that file's
# comments). That is the one and only source of truth this script trusts
# for PREVIOUS. If the marker is missing, or points at something that
# isn't a locally SHA-tagged image of that repo, retention for that WHOLE
# project is skipped -- no fallback guess of any kind.
#
# Everything else tagged with a 40-hex-char commit SHA for that repo is a
# DELETE candidate. Non-SHA tags (`:latest`, `:pre-*-backup`,
# `:pre-*-rollback`, bare non-ghcr repo names left over from before GHCR
# was adopted) are NEVER included in an automatic delete set -- they are
# only listed, for a human to decide about, because their purpose can't be
# verified purely from Docker state (see the LEGACY section of the
# report).
#
# MIGRATOR RETENTION -- verified against every deploy AND every documented
# manual recovery path, not assumed
# poker-app and poker-clock: migrator only ever runs ONCE per deploy
# (`docker compose run --rm migrate`, same commit SHA as the app), and
# deploy.yml `docker pull`s that exact SHA tag unconditionally right before
# running it -- it never checks for or relies on a local copy already
# being present. Rollback (see each deploy.yml) NEVER re-runs the previous
# migrator image -- it only recreates the app container against the
# previous APP image. The documented manual recovery procedures
# (poker-app/docs/VPS_DEPLOYMENT.md, poker-clock/DEPLOY_VPS.md) both do the
# same explicit `docker pull ...migrator:$SHA` before running it by hand --
# neither assumes or benefits from a cached local copy either.
# re-raise: migrator is decoupled from app deploys entirely (a separate
# workflow_dispatch-only production-migrations.yml) and that workflow also
# always `docker pull`s its migrator image fresh from GHCR regardless of
# what's cached locally.
# spb-poker: no SHA-tagged migrator images are part of this project's
# pipeline at all (deploy.yml never builds one).
#
# Conclusion: no deploy, rollback, or documented manual recovery path in
# any of the four projects depends on a locally-cached migrator image --
# every one of them pulls by exact SHA from GHCR unconditionally before
# running it. So migrator retention keeps nothing on purpose: every
# locally-present SHA-tagged migrator image for reraise/poker-app/
# poker-clock is a DELETE candidate at every maintenance run (still
# subject to the same running-container safety check as everything else,
# for the rare case a migrator container is caught mid-run). GHCR remains
# the source of truth for the next migration/deploy to pull from -- see
# the report for confirmation this was checked, not assumed. spb-poker has
# no SHA-tagged migrator images in its pipeline at all and is left
# entirely untouched (see LEGACY).
#
# SAFETY MODEL
# - Default mode is --dry-run: computes and prints KEEP/DELETE, deletes
#   nothing.
# - --apply requires CONFIRM=DELETE-PRODUCTION-IMAGES in the environment,
#   and even then: every `docker rmi` is for one specific image ID, never
#   `-f` (force). Docker itself refuses to remove an image referenced by
#   any container, running or stopped, without -f -- so even if a deploy
#   races this script and makes a "to-be-deleted" image current again
#   between this script's snapshot and its delete step, the delete for
#   that one image simply fails (logged, non-fatal) instead of corrupting
#   a running container. This script additionally re-checks, immediately
#   before each individual delete, that the image ID is not the `.Image`
#   of any currently running container on the host (belt-and-suspenders on
#   top of Docker's own protection, and on top of the shared VPS lock --
#   see the locking contract below).
# - If CURRENT or PREVIOUS can't be established with certainty, the
#   project is SKIPPED ENTIRELY with a warning. No guessing, ever.
#
# CONCURRENCY NOTE (see report for full discussion)
# GitHub Actions `concurrency: production-deploy` groups are scoped per
# repository, not per VPS -- confirmed in this VPS's own workflow comments
# (poker-app/spb-poker maintenance.yml). The real cross-repo mutex is
# /var/lock/poker-production.lock (see the locking contract below) --
# as of this version, only re-raise's deploy.yml and maintenance.yml take
# it; poker-app, poker-clock and spb-poker do not yet (see report), so
# scheduled --apply runs stay disabled until they do.
#
# USAGE (run directly on the VPS, as root, via the same SSH access
# deploy.yml/maintenance.yml use):
#   bash retention.sh                 # dry run (default), all projects
#   bash retention.sh --dry-run
#   CONFIRM=DELETE-PRODUCTION-IMAGES bash retention.sh --apply
#
# No bootstrap step and no bootstrap-preview flag: the rollback-previous
# marker is created the ordinary way, by that project's own first
# successful deploy after this feature ships (see deploy.yml) -- old
# CURRENT becomes the marker target the moment the new deploy passes
# health+smoke. Until a project's first such deploy happens, retention for
# it stays fail-closed (0 deletions), which is the correct, safe state --
# not an error to work around.
#
# This script only ever reads Docker state and (in --apply mode) removes
# specific image IDs it has just computed. It never touches containers,
# volumes, networks, bind mounts, or the rollback-previous marker itself
# (only deploy.yml ever writes that).
#
# LOCKING CONTRACT -- READ BEFORE WIRING --apply INTO ANYTHING
# This script does NOT acquire /var/lock/poker-production.lock itself.
# That is deliberate, not an oversight: maintenance.yml's remote script
# already holds that flock for its entire run (see that file) before it
# ever invokes this script, and a shared flock is per-open-file-
# description -- if this script tried to flock the same path again from
# inside an already-locked parent process tree, it would either deadlock
# (blocking wait) or spuriously fail (non-blocking), depending on how it
# was called. So the rule is simple: whatever calls this script with
# --apply MUST already hold /var/lock/poker-production.lock for the
# duration of the call. --dry-run does not need the lock (it only reads
# Docker state), but running it standalone outside the lock means the
# snapshot it reports -- CURRENT, and the rollback-previous marker's
# target -- can be concurrently changed by an in-flight deploy. Fine for a
# manual look, not a substitute for the locked run when you actually care
# about an authoritative pre-apply picture.

set -Eeuo pipefail

# Merge stderr into stdout right away. Without this, WARNING lines (stderr,
# unbuffered) can print out of order relative to the surrounding stdout
# (fully block-buffered once redirected to a file/pipe, as both
# maintenance.yml and a manual `ssh ... > out.txt 2>&1` do) -- purely a
# buffering artifact, not a logic bug, but confusing to read. Forcing both
# through one fd keeps everything in true emission order everywhere this
# script is run.
exec 2>&1

MODE="dry-run"
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --apply) MODE="apply" ;;
    *)
      echo "Unknown argument: $arg (expected --dry-run or --apply)" >&2
      exit 2
      ;;
  esac
done

if [ "$MODE" = "apply" ] && [ "${CONFIRM:-}" != "DELETE-PRODUCTION-IMAGES" ]; then
  echo "Refusing --apply without CONFIRM=DELETE-PRODUCTION-IMAGES in the environment." >&2
  exit 2
fi

SHA_RE='^[0-9a-f]{40}$'
MARKER_TAG_SUFFIX="rollback-previous"

# key -> value config, one line per project. Fields:
#   key | app_repo | container | migrator_repo | migrator_mode
# migrator_mode (see MIGRATOR RETENTION in the header comment for why):
#   delete-all -- every locally-present SHA-tagged migrator image for this
#                 repo is a DELETE candidate, no exceptions kept on
#                 purpose (reraise, poker-app, poker-clock: confirmed no
#                 deploy/rollback/manual-recovery path depends on a local
#                 copy -- all of them `docker pull` by SHA unconditionally).
#   none       -- left entirely untouched, reported under LEGACY only
#                 (spb-poker: no SHA-tagged migrator images exist in this
#                 project's pipeline at all).
PROJECTS=(
  "reraise|ghcr.io/isawyou/re-raise|re-raise|ghcr.io/isawyou/re-raise-migrator|delete-all"
  "poker-app|ghcr.io/krestall69/poker-app|poker-app|ghcr.io/krestall69/poker-app-migrator|delete-all"
  "poker-clock|ghcr.io/krestall69/poker-clock|poker-clock|ghcr.io/krestall69/poker-clock-migrator|delete-all"
  "spb-poker|ghcr.io/krestall69/spb-poker|spb-poker|ghcr.io/krestall69/spb-poker-migrator|none"
)

declare -A RUNNING_IMAGE_IDS=()

section() { printf '\n================ %s ================\n' "$1"; }

human_size() {
  local bytes="$1"
  awk -v b="$bytes" 'BEGIN {
    split("B KB MB GB TB", units, " ")
    u = 1
    while (b >= 1024 && u < 5) { b /= 1024; u++ }
    printf "%.2f %s", b, units[u]
  }'
}

refresh_running_image_ids() {
  RUNNING_IMAGE_IDS=()
  local cid img
  while IFS= read -r cid; do
    [ -z "$cid" ] && continue
    img="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
    [ -n "$img" ] && RUNNING_IMAGE_IDS["$img"]=1
  done < <(docker ps -q)
}

# Prints "<epoch>\t<id>\t<tag>\t<size>" for every locally-present image
# whose tag on $1 (a repo) matches the 40-hex-char SHA pattern, one line
# per distinct image ID, sorted by epoch descending (newest build first).
# This is the app/migrator inventory that KEEP/DELETE is computed against.
# The epoch/ordering is informational only (shown in output) -- it is
# NEVER used to decide what PREVIOUS is; that comes only from the
# rollback-previous marker (see header).
list_sha_images() {
  local repo="$1"
  local -A seen_ids=()
  local id tag created epoch size
  while IFS=$'\t' read -r id tag; do
    [[ "$tag" =~ $SHA_RE ]] || continue
    [ -n "${seen_ids[$id]:-}" ] && continue
    seen_ids["$id"]=1
    created="$(docker inspect --format '{{.Created}}' "$id")"
    epoch="$(date -d "$created" +%s)"
    size="$(docker inspect --format '{{.Size}}' "$id")"
    printf '%s\t%s\t%s\t%s\n' "$epoch" "$id" "$tag" "$size"
  done < <(docker images --no-trunc --format $'{{.ID}}\t{{.Tag}}' "$repo" 2>/dev/null) \
    | sort -t $'\t' -k1,1 -rn
}

# Resolves a tag to its full image ID, or empty if the tag doesn't exist
# locally. Never errors on a missing tag (that's the expected steady
# state before a project's first deploy since this feature shipped has
# created its rollback-previous marker).
resolve_tag_id() {
  docker image inspect --no-trunc --format '{{.Id}}' "$1" 2>/dev/null || true
}

TOTAL_DELETE_COUNT=0
TOTAL_DELETE_BYTES=0
declare -a SUMMARY_ROWS=()
declare -a DELETE_QUEUE=()   # "repo:tag|id|reason"

process_project() {
  local key="$1" app_repo="$2" container="$3" migrator_repo="$4" migrator_mode="$5"

  section "PROJECT: $key"

  if ! docker inspect "$container" >/dev/null 2>&1; then
    echo "WARNING: container '$container' not found on this host -- skipping $key entirely (no destructive action taken)." >&2
    SUMMARY_ROWS+=("$key|SKIPPED (container not found)|-|-|-|-")
    return
  fi

  local status health
  status="$(docker inspect --format '{{.State.Status}}' "$container")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$container")"
  echo "Container: $container  status=$status  health=$health"

  if [ "$status" != "running" ]; then
    echo "WARNING: '$container' is not running -- skipping $key entirely (cannot establish CURRENT from a non-running container)." >&2
    SUMMARY_ROWS+=("$key|SKIPPED (container not running)|-|-|-|-")
    return
  fi

  local current_id
  current_id="$(docker inspect --format '{{.Image}}' "$container")"

  local -a rows=()
  mapfile -t rows < <(list_sha_images "$app_repo")

  if [ "${#rows[@]}" -eq 0 ]; then
    echo "WARNING: no SHA-tagged images found locally for $app_repo -- skipping $key (nothing to safely reason about)." >&2
    SUMMARY_ROWS+=("$key|SKIPPED (no SHA images found)|-|-|-|-")
    return
  fi

  local cur_sha="" cur_size=""
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r ep id tag size <<<"$row"
    if [ "$id" = "$current_id" ]; then cur_sha="$tag"; cur_size="$size"; fi
  done

  if [ -z "$cur_sha" ]; then
    echo "WARNING: running container's image ID ($current_id) is not tagged with any known SHA for $app_repo locally -- skipping $key. This can happen if the image was pulled by digest only, or the tag was already removed by hand. Refusing to guess." >&2
    SUMMARY_ROWS+=("$key|SKIPPED (current image untagged/ambiguous)|-|-|-|-")
    return
  fi

  echo "CURRENT: $app_repo:$cur_sha  (id=${current_id:7:12} size=$(human_size "$cur_size"))"

  # ---- PREVIOUS, from the persistent marker -- NEVER from build order ----
  local marker_tag="$app_repo:$MARKER_TAG_SUFFIX"
  local prev_id prev_sha=""
  prev_id="$(resolve_tag_id "$marker_tag")"

  if [ -z "$prev_id" ]; then
    echo "WARNING: no $marker_tag marker found -- skipping $key entirely (fail-closed). This is expected until $key's own first successful deploy after this feature shipped creates the marker (see deploy.yml)." >&2
    SUMMARY_ROWS+=("$key|$app_repo:$cur_sha|MISSING (fail-closed)|-|-|-")
    return
  fi

  for row in "${rows[@]}"; do
    IFS=$'\t' read -r ep id tag size <<<"$row"
    [ "$id" = "$prev_id" ] && prev_sha="$tag"
  done

  if [ -z "$prev_sha" ]; then
    echo "WARNING: $marker_tag (id=${prev_id:7:12}) does not match any known SHA-tagged $app_repo image locally -- marker is stale or corrupt. Skipping $key entirely (fail-closed)." >&2
    SUMMARY_ROWS+=("$key|$app_repo:$cur_sha|CORRUPT MARKER (fail-closed)|-|-|-")
    return
  fi

  echo "PREVIOUS: $app_repo:$prev_sha  (id=${prev_id:7:12})  [source: $marker_tag marker]"

  local -A app_keep_ids=()
  app_keep_ids["$current_id"]=1
  app_keep_ids["$prev_id"]=1

  local app_delete_count=0 app_delete_bytes=0
  echo "APP DELETE candidates:"
  for row in "${rows[@]}"; do
    IFS=$'\t' read -r ep id tag size <<<"$row"
    [ -n "${app_keep_ids[$id]:-}" ] && continue
    if [ -n "${RUNNING_IMAGE_IDS[$id]:-}" ]; then
      echo "  SKIP (in use by a running container despite not being CURRENT/PREVIOUS -- investigate manually): $app_repo:$tag id=${id:7:12}" >&2
      continue
    fi
    echo "  $app_repo:$tag  id=${id:7:12}  created=$(date -d "@$ep" -u +%FT%TZ)  size=$(human_size "$size")"
    DELETE_QUEUE+=("$app_repo:$tag|$id|app:$key")
    app_delete_count=$((app_delete_count+1))
    app_delete_bytes=$((app_delete_bytes+size))
  done
  [ "$app_delete_count" -eq 0 ] && echo "  (none)"

  # ---- migrator ----
  local migrator_delete_count=0 migrator_delete_bytes=0
  echo "MIGRATOR MODE: $migrator_mode"
  case "$migrator_mode" in
    none)
      echo "  (not part of this project's automated pipeline -- left untouched, see LEGACY section)"
      ;;
    delete-all)
      local -a mrows=()
      mapfile -t mrows < <(list_sha_images "$migrator_repo")
      echo "  Keeping none on purpose -- no deploy, rollback, or documented manual recovery path"
      echo "  for $key depends on a locally-cached migrator image (all pull by exact SHA from GHCR"
      echo "  unconditionally before running it -- see header). Every SHA-tagged migrator image"
      echo "  found locally is a DELETE candidate."
      echo "  MIGRATOR DELETE candidates:"
      for row in "${mrows[@]}"; do
        IFS=$'\t' read -r ep id tag size <<<"$row"
        if [ -n "${RUNNING_IMAGE_IDS[$id]:-}" ]; then
          echo "    SKIP (in use by a running container -- e.g. a migrator run caught mid-flight by this maintenance run): $migrator_repo:$tag id=${id:7:12}" >&2
          continue
        fi
        echo "    $migrator_repo:$tag  id=${id:7:12}  created=$(date -d "@$ep" -u +%FT%TZ)  size=$(human_size "$size")"
        DELETE_QUEUE+=("$migrator_repo:$tag|$id|migrator:$key")
        migrator_delete_count=$((migrator_delete_count+1))
        migrator_delete_bytes=$((migrator_delete_bytes+size))
      done
      [ "$migrator_delete_count" -eq 0 ] && echo "    (none)"
      ;;
  esac

  local total_count=$((app_delete_count+migrator_delete_count))
  local total_bytes=$((app_delete_bytes+migrator_delete_bytes))
  TOTAL_DELETE_COUNT=$((TOTAL_DELETE_COUNT+total_count))
  TOTAL_DELETE_BYTES=$((TOTAL_DELETE_BYTES+total_bytes))
  SUMMARY_ROWS+=("$key|$app_repo:$cur_sha|$app_repo:$prev_sha|marker|$total_count|$(human_size "$total_bytes")")
}

section "LEGACY / PINNED TAGS (never auto-deleted -- listed for manual review only)"
echo "Images that don't match any configured project's ghcr.io/<owner>/<repo>:<40-hex-sha>"
echo "pattern above, and aren't a known-in-use base image. This includes ':latest' tags,"
echo "'pre-*-rollback'/'pre-*-backup' emergency pins, bare (non-ghcr) leftover names from"
echo "before this VPS's projects moved to GHCR, and the new rollback-previous markers"
echo "themselves (they ARE used by this script, just not deleted, so they show up here too"
echo "for visibility). Their purpose was checked against each project's compose file (see"
echo "report), but NONE are included in any DELETE set by this script -- deleting a"
echo "mistakenly-kept emergency pin is a much worse outcome than a few hundred MB of disk."
echo ""

refresh_running_image_ids

declare -A KNOWN_APP_REPOS=() KNOWN_MIGRATOR_REPOS=()
for entry in "${PROJECTS[@]}"; do
  IFS='|' read -r key app_repo container migrator_repo migrator_mode <<<"$entry"
  KNOWN_APP_REPOS["$app_repo"]=1
  KNOWN_MIGRATOR_REPOS["$migrator_repo"]=1
done

while IFS=$'\t' read -r repo tag id size; do
  [ "$repo" = "<none>" ] && continue
  if [[ -n "${KNOWN_APP_REPOS[$repo]:-}" || -n "${KNOWN_MIGRATOR_REPOS[$repo]:-}" ]] && [[ "$tag" =~ $SHA_RE ]]; then
    continue
  fi
  in_use="no"
  [ -n "${RUNNING_IMAGE_IDS[$id]:-}" ] && in_use="YES - running container"
  echo "  $repo:$tag  id=${id:7:12}  size=$(human_size "$size")  in_use=$in_use"
done < <(docker images --no-trunc --format $'{{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.Size}}' | awk -F'\t' '{print $1"\t"$2"\t"$3}' | while IFS=$'\t' read -r repo tag id; do
    size="$(docker inspect --format '{{.Size}}' "$id" 2>/dev/null || echo 0)"
    printf '%s\t%s\t%s\t%s\n' "$repo" "$tag" "$id" "$size"
  done)

for entry in "${PROJECTS[@]}"; do
  IFS='|' read -r key app_repo container migrator_repo migrator_mode <<<"$entry"
  process_project "$key" "$app_repo" "$container" "$migrator_repo" "$migrator_mode"
done

section "SUMMARY"
printf '%-12s | %-46s | %-30s | %-8s | %-6s | %-10s\n' "PROJECT" "CURRENT" "PREVIOUS-GOOD" "SOURCE" "DELETE" "RECLAIM"
printf -- '-%.0s' {1..130}; echo
for row in "${SUMMARY_ROWS[@]}"; do
  IFS='|' read -r p c pr src n sz <<<"$row"
  printf '%-12s | %-46s | %-30s | %-8s | %-6s | %-10s\n' "$p" "$c" "$pr" "$src" "$n" "$sz"
done
echo ""
echo "Total DELETE candidates across all projects: $TOTAL_DELETE_COUNT"
echo "Naive estimated reclaim (sum of image Sizes; shared base layers between images are NOT deduplicated in this estimate, so actual 'docker system df' reclaim after a real run will normally be LESS than this number): $(human_size "$TOTAL_DELETE_BYTES")"

if [ "$MODE" = "dry-run" ]; then
  section "DRY RUN -- NOTHING WAS DELETED"
  echo "${#DELETE_QUEUE[@]} image(s) would be removed with --apply. Re-run with --apply and"
  echo "CONFIRM=DELETE-PRODUCTION-IMAGES set to actually delete them."
  exit 0
fi

section "APPLYING DELETES"
refresh_running_image_ids
for entry in "${DELETE_QUEUE[@]}"; do
  IFS='|' read -r ref id reason <<<"$entry"
  if [ -n "${RUNNING_IMAGE_IDS[$id]:-}" ]; then
    echo "SKIP (became in-use since the plan was computed -- a deploy likely raced this run): $ref ($reason)"
    continue
  fi
  echo "Removing $ref  id=${id:7:12}  ($reason)"
  if ! docker rmi "$id" 2>&1; then
    echo "  -> failed to remove (likely still referenced by something) -- left in place, not fatal." >&2
  fi
done

section "DONE"
