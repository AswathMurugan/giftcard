#!/usr/bin/env bash
#
# Manage the local-dev workspace at codegen-starter/tmp/current/.
#
# Two modes:
#
#   ./scripts/new-session.sh             Fresh session: confirms before
#                                        nuking tmp/current/, then copies
#                                        starter + fetches entities +
#                                        starts Vite.
#
#   ./scripts/new-session.sh --force     Same as above, skip the confirm.
#
#   ./scripts/new-session.sh --resume    Resume the existing tmp/current/:
#                                        skip wipe, skip rsync, skip entity
#                                        fetch — just restart Vite. Chat
#                                        history under tmp/current/.sessions/
#                                        (one folder per conversationId) is
#                                        preserved.
#
# To back up an existing session, run with no flag, choose 'n' at the
# prompt, and pick a name when asked.

set -e

FORCE=0
RESUME=0
for arg in "$@"; do
  case "$arg" in
    -f|--force) FORCE=1 ;;
    -r|--resume) RESUME=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

# Run from the codegen-starter root regardless of where this is invoked.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$STARTER_DIR"

WORKSPACE="$STARTER_DIR/tmp/current"

# ── Resume path: short-circuit everything except the kill + Vite spawn ──────
if [ "$RESUME" -eq 1 ]; then
  if [ ! -d "$WORKSPACE" ] || [ ! -f "$WORKSPACE/package.json" ]; then
    echo "⚠️  Nothing to resume — $WORKSPACE/ is empty or missing."
    echo "    Run ./scripts/new-session.sh to create a fresh session."
    exit 1
  fi

  echo "Killing any process on :3001..."
  lsof -ti :3001 | xargs kill -9 2>/dev/null || true
  sleep 0.5

  echo ""
  echo "──────────────────────────────────────────────────────────"
  echo "  Resuming session"
  echo "  Workspace:  $WORKSPACE"
  echo "  Vite URL:   http://localhost:3001"
  echo "  Ctrl-C to stop."
  echo "──────────────────────────────────────────────────────────"
  echo ""

  cd "$WORKSPACE"
  exec npm run dev -- --port 3001 --strictPort --force
fi

# ── 1. Confirmation gate (fresh-session path) ───────────────────────────────
if [ -d "$WORKSPACE" ] && [ "$FORCE" -ne 1 ]; then
  echo ""
  echo "⚠️  tmp/current/ already exists."
  echo "    y      — delete it and start fresh"
  echo "    n      — auto-rename to tmp/backup-<timestamp> first, then start fresh"
  echo "    Ctrl-C — abort"
  echo ""
  echo "    (To keep working in the current session, run with --resume instead.)"
  echo ""
  read -p "Overwrite? [y/n] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Nn]$ ]]; then
    DEFAULT_NAME="backup-$(date +%Y%m%d-%H%M%S)"
    read -p "Backup name (will save as tmp/<name>/) [$DEFAULT_NAME]: " SESSION_NAME
    SESSION_NAME="${SESSION_NAME:-$DEFAULT_NAME}"
    # Strip leading tmp/ if user pasted it, and sanitize slashes.
    SESSION_NAME="${SESSION_NAME#tmp/}"
    SESSION_NAME="${SESSION_NAME//\//-}"
    BACKUP="tmp/$SESSION_NAME"
    if [ -d "$BACKUP" ]; then
      echo "⚠️  $BACKUP/ already exists. Aborting (rename or delete it first)."
      exit 1
    fi
    echo "Backing up tmp/current/ → $BACKUP/"
    mv tmp/current "$BACKUP"
  elif [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

# ── 2. Kill anything on port 3001 ───────────────────────────────────────────
echo "Killing any process on :3001..."
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
sleep 0.5

# ── 3. Strip macOS quarantine from node_modules ─────────────────────────────
# Some npm-shipped native binaries (esbuild, swc, vite native deps) get
# Gatekeeper-quarantined on download and refuse to execute until cleared.
# No-op on Linux/Docker (xattr exits silently).
if [[ "$OSTYPE" == "darwin"* ]] && [ -d "node_modules" ]; then
  echo "Stripping Gatekeeper quarantine on node_modules..."
  xattr -dr com.apple.quarantine node_modules 2>/dev/null || true
fi

# ── 4. Fresh copy of starter into tmp/current/ ──────────────────────────────
echo "Refreshing tmp/current/..."
rm -rf "$WORKSPACE"
mkdir -p "$WORKSPACE"

rsync -a \
  --exclude=tmp \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.git \
  --exclude=.DS_Store \
  --exclude=.nx \
  --exclude=.vite \
  ./ "$WORKSPACE/"

# ── 5. Symlink node_modules ─────────────────────────────────────────────────
# Shared, read-only. ~600 MB stays in one place.
ln -s "$STARTER_DIR/node_modules" "$WORKSPACE/node_modules"

# ── 6a. Fetch tenant enumerations ───────────────────────────────────────────
# Must run BEFORE entities and saved queries so the entity / saved-query
# codegen can resolve `Enumeration` fields to typed unions instead of
# bare `string`.
echo "Fetching tenant enumerations..."
FETCH_ENUMERATIONS_OUT_DIR="$WORKSPACE/src/types/enumerations" \
  npx tsx scripts/fetch-enumerations.ts

# ── 6. Fetch tenant entities ────────────────────────────────────────────────
# Reads PHOENIX_API_URL + TENANT_ID from codegen-starter/.env.
echo "Fetching tenant entities..."
FETCH_ENTITIES_OUT_DIR="$WORKSPACE/src/types/entities" \
  npx tsx scripts/fetch-entities.ts

# ── 6a+. Fetch platform skills (agents) ─────────────────────────────────────
# One tenant-wide GET to component-definitions-all/skill-definition. Emits
# src/types/skills.{catalog.md,generated.ts} for app code + the agent catalog.
# Independent of the other codegens; placed early so a later step's failure
# (e.g. a preferences 500) can't abort the run before skills is fetched.
echo "Fetching platform skills (agents)..."
FETCH_SKILLS_OUT_DIR="$WORKSPACE/src/types" \
  npx tsx scripts/fetch-skills.ts

# ── 6b. Fetch tenant saved queries ──────────────────────────────────────────
# Emits per-query TS modules + master registry + agent-facing catalog.
# Saved queries are READ-ONLY (writes go through useEntityMutation).
echo "Fetching tenant saved queries..."
FETCH_SAVED_QUERIES_OUT_DIR="$WORKSPACE/src/types/saved-queries" \
  npx tsx scripts/fetch-saved-queries.ts

# ── 6b+. scripts/ is rsynced wholesale (see step 4) ────────────────────────
# It used to be excluded and then re-copied file-by-file, which silently broke
# every time the starter gained a script: in-session consumers (create_entity,
# create_saved_query, /__jiffy/refetch) spawn these with cwd = this workspace,
# and vite.config.ts IMPORTS one at config-load time — a missing file there
# stops the dev server booting. Cloud never had the problem (the workspace is
# a clone of the starter repo, which tracks all of scripts/), so copying the
# whole directory is also what makes local match cloud.

# ── 6c. Fetch tenant workflows ──────────────────────────────────────────────
# Emits per-workflow TS modules + master registry + agent-facing catalog.
# Workflows have SIDE EFFECTS — consumed via useWorkflow(name).mutate(input).
# V1 sync only; async workflows are skipped with a console.log.
echo "Fetching tenant workflows..."
FETCH_WORKFLOWS_OUT_DIR="$WORKSPACE/src/types/workflows" \
  npx tsx scripts/fetch-workflows.ts

# ── 6d. Fetch tenant partner modules ────────────────────────────────────────
# Emits per-module TS modules + master registry + category-grouped catalog.
# Partner modules invoke external systems with SIDE EFFECTS — consumed
# via usePartnerModule(name).mutate(input). Categorised modules route via
# /api/proxy/execute-partner-category/{category}/{name}.
echo "Fetching tenant partner modules..."
FETCH_PARTNER_MODULES_OUT_DIR="$WORKSPACE/src/types/partner-modules" \
  npx tsx scripts/fetch-partner-modules.ts

# ── 6e. Fetch deployed application metadata ────────────────────────────────
# Writes src/types/app.md (agent-facing reference) + src/types/app.generated.ts
# (typed APPLICATION const used by DefaultLayout for brand + read by the
# agent for app.label / app_definition_key context). PHX-3863 Task 3.
echo "Fetching deployed application metadata..."
FETCH_APPLICATION_OUT_DIR="$WORKSPACE/src/types" \
  npx tsx scripts/fetch-application.ts

# ── 6e+. Fetch branding preferences (favicon / logo / theme) ────────────────
# Bakes the current app's Branding-category preferences into
# src/types/preferences.generated.ts so BrandingProvider can apply them on first
# paint (seeded as usePreferences placeholder); the live merged-preferences
# fetch overrides at runtime. Runs AFTER fetch-application (reads its
# app_definition_key to scope to the current app).
echo "Fetching branding preferences..."
FETCH_PREFERENCES_OUT_DIR="$WORKSPACE/src/types" \
  npx tsx scripts/fetch-preferences.ts

# ── 6f. Fetch tenant reference data ─────────────────────────────────────────
# Stable TENANT-wide config / hierarchy (roles, permission-groups, org,
# org_level). Snapshotted to typed consts + catalogs under src/types/ — these
# don't change within a session, so they're baked at bootstrap, not fetched at
# runtime. permission-groups + org/org_level require an app-context header; the
# script always sends the tenant-wide `platform` lens (no app env needed).
echo "Fetching tenant reference data (roles, permission-groups, org)..."
FETCH_TENANT_REFS_OUT_DIR="$WORKSPACE/src/types" \
  npx tsx scripts/fetch-tenant-refs.ts

# NOTE: the FULL merged preferences are still read at RUNTIME (BrandingProvider
# via usePreferences). fetch-preferences above only bakes a first-paint default
# (branding category) so the favicon/theme don't flash; runtime overrides.
# (Legacy note retained:) tenant preferences are read at RUNTIME via
# usePreferences(); a null App.Theme falls back to DEFAULT_THEME.

# ── 6g. Initialize git history (local turn-commits) ────────────────────────
# Local counterpart of the cloud baked /workspace git repo: the backend's
# save machinery commits the workspace after every turn, and the review
# agent reads that history (git_log / git_show). Without .git here those
# commits have nowhere to land (the old "spawn git ENOENT" local behaviour).
# The .gitignore MUST be the exact set the cloud bootstrap writes
# (backend-node/src/bootstrap/repo.ts GITIGNORE_CONTENT) — notably it
# excludes .sessions/ and .env so journals + secrets never enter history.
# Baseline commit runs AFTER the codegens so turn-diffs start clean (mirrors
# an attached cloud workspace, whose clone already contains them).
echo "Initializing git history (local turn-commits)..."
cat > "$WORKSPACE/.gitignore" <<'GITIGNORE'
node_modules/
dist/
.vite/
.vite.log
.sessions/
.env
.env.*
*.log
.DS_Store
.nx/
GITIGNORE
(
  cd "$WORKSPACE"
  git init -q -b main
  git add -A
  git -c user.email="editor@jiffy.local" -c user.name="Jiffy Editor" \
    commit -q -m "Fresh workspace baseline"
)

# ── 7. Start Vite (foreground) ──────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "  Workspace:  $WORKSPACE"
echo "  Vite URL:   http://localhost:3001"
echo "  Ctrl-C to stop the session."
echo "──────────────────────────────────────────────────────────"
echo ""

# --force re-optimizes deps on startup. The agent often adds new imports
# (recharts, date-fns, etc.) that weren't in the pre-bundled set, and
# without --force Vite serves the stale optimizer cache and the iframe
# gets 504 "Outdated Optimize Dep" errors. ~5s extra startup cost.
cd "$WORKSPACE"
exec npm run dev -- --port 3001 --strictPort --force
