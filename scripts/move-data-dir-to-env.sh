#!/bin/sh
# Move the app's data-folder setting out of a hand edit in docker-compose.yml
# and into .env — for a server set up before TASKFLOW_DATA_DIR existed.
#
# Before that setting, pointing the app at a folder other than the default
# meant editing docker-compose.yml on the server. That edit blocks updates
# whenever the file changes upstream, and discarding it by mistake would
# start the app on the wrong, empty folder. This puts the same folder in
# .env, where a machine's own settings belong, and leaves the compose file
# on the server identical to the repo's.
#
# What it does, in order. If a check fails it stops, having changed nothing:
#   1. reads the folder the RUNNING app is actually using, from Docker
#   2. checks the database really is in that folder
#   3. checks the only hand edit in docker-compose.yml is that one folder line
#   4. writes TASKFLOW_DATA_DIR=<that folder> to .env
#   5. drops the hand edit and moves forward to the fetched version
#   6. asks docker compose which folder it would now use, and compares
# If step 5 or 6 goes wrong, every file is put back exactly as it was.
# It never starts, stops or restarts a container.
#
# Run it from the project folder, after fetching:
#   git fetch origin <branch>
#   git show FETCH_HEAD:scripts/move-data-dir-to-env.sh > /tmp/move-data-dir.sh
#   sh /tmp/move-data-dir.sh
# If `docker compose` needs its own HOME on this machine, pass it as
# COMPOSE_HOME=<folder>; git keeps the environment it is normally run with.
# Safe to run again: once it's done, it only re-checks.

set -eu

VAR=TASKFLOW_DATA_DIR
TARGET=/app/backend/data
DB_NAME=taskflow.sqlite
SERVICE=taskflow
COMPOSE_FILE=docker-compose.yml
NEW=${MOVE_DATA_DIR_REF:-FETCH_HEAD}

say() { printf '%s\n' "$*"; }

compose() {
  if [ -n "${COMPOSE_HOME:-}" ]; then
    env HOME="$COMPOSE_HOME" docker compose "$@" </dev/null
  else
    docker compose "$@" </dev/null
  fi
}

# Only for use before anything has been changed.
stop() {
  say ""
  say "STOPPED: $*"
  say "Nothing was changed."
  exit 1
}

# ── 0. The right place, with what's needed ───────────────────────────────────
[ -f "$COMPOSE_FILE" ] && [ -e .git ] || stop "run this from the project folder (the one with $COMPOSE_FILE)."
[ -f .env ] || stop "there is no .env file here."
command -v git >/dev/null 2>&1 || stop "git isn't available."
command -v docker >/dev/null 2>&1 || stop "docker isn't available."
git rev-parse -q --verify "$NEW^{commit}" >/dev/null 2>&1 || stop "there is no fetched version to move to. Fetch first."
git show "$NEW:$COMPOSE_FILE" 2>/dev/null | grep -q "$VAR" || stop "the fetched version doesn't use $VAR."
git merge-base --is-ancestor HEAD "$NEW" 2>/dev/null || stop "this copy has commits the fetched version doesn't, so it can't simply move forward to it."

OTHER=$(git status --porcelain --untracked-files=no | grep -v " $COMPOSE_FILE\$" || true)
[ -z "$OTHER" ] || stop "other files here have hand edits, which this script won't touch:
$OTHER"

# ── 1. The folder the running app actually uses ──────────────────────────────
CID=$(docker ps -q --filter "label=com.docker.compose.service=$SERVICE" --filter "label=com.docker.compose.project.working_dir=$PWD" </dev/null | head -n 1)
if [ -z "$CID" ]; then
  CID=$(compose ps -q "$SERVICE" 2>/dev/null | head -n 1)
fi
[ -n "$CID" ] || stop "the app ($SERVICE) isn't running, so there's no telling which folder it uses."

# As it was given to Docker when the container was created…
DIR=$(docker inspect -f '{{range .HostConfig.Binds}}{{println .}}{{end}}' "$CID" </dev/null |
  sed -n "s#^\(/.*\):$TARGET\(:[A-Za-z,]*\)\{0,1\}\$#\1#p" | head -n 1)
# …or, for a container created another way, as Docker reports it now.
if [ -z "$DIR" ]; then
  DIR=$(docker inspect -f "{{range .Mounts}}{{if eq .Destination \"$TARGET\"}}{{.Source}}{{end}}{{end}}" "$CID" </dev/null)
fi

case "$DIR" in
  /*) ;;
  *) stop "couldn't read the app's data folder from Docker (got: '$DIR')." ;;
esac
case "$DIR" in
  *[!A-Za-z0-9/_.-]*) stop "the data folder's path has characters this script won't write to .env by itself: $DIR" ;;
esac

# ── 2. The database really is there ──────────────────────────────────────────
[ -d "$DIR" ] || stop "the folder the app is using doesn't exist here: $DIR"
[ -f "$DIR/$DB_NAME" ] || stop "there is no database ($DB_NAME) in $DIR, so it can't be confirmed as the data folder."

# ── 3. What's already in .env, and what was edited by hand ───────────────────
if grep -q "^[[:space:]]*export[[:space:]][[:space:]]*$VAR=" .env; then
  stop ".env sets $VAR with 'export', which this script doesn't edit. Remove the word 'export' from that line and run it again."
fi
CURRENT=$(sed -n "s/^[[:space:]]*$VAR=//p" .env | tail -n 1 |
  sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$DIR" ]; then
  stop ".env already says $VAR=$CURRENT, but the running app uses $DIR. One of them is wrong, and this script won't guess which."
fi

HEAD_USES_VAR=no
if git show "HEAD:$COMPOSE_FILE" | grep -q "$VAR"; then HEAD_USES_VAR=yes; fi

EDITED=no
if ! git diff --quiet -- "$COMPOSE_FILE"; then
  EDITED=yes
  REMOVED=$(git diff -U0 -- "$COMPOSE_FILE" | grep '^-' | grep -v '^--- ' | sed 's/^-[[:space:]]*//')
  ADDED=$(git diff -U0 -- "$COMPOSE_FILE" | grep '^+' | grep -v '^+++ ' | sed 's/^+[[:space:]]*//')
  # The only edit this script will discard: one data-folder line swapped
  # for another.
  EDIT_DIR=$(printf '%s\n' "$ADDED" | sed -n "s#^- \(/.*\):$TARGET\$#\1#p")
  if [ "$HEAD_USES_VAR" = yes ] ||
    [ -z "$EDIT_DIR" ] ||
    [ "$(printf '%s\n' "$ADDED" | wc -l | tr -d ' ')" != 1 ] ||
    [ "$(printf '%s\n' "$REMOVED" | wc -l | tr -d ' ')" != 1 ] ||
    ! printf '%s\n' "$REMOVED" | grep -q "^- /.*:$TARGET\$"; then
    stop "$COMPOSE_FILE has hand edits other than the one data-folder line, and this script won't discard them:
$(git diff -U0 -- "$COMPOSE_FILE" | grep '^[-+]' | grep -v '^--- ' | grep -v '^+++ ')"
  fi
  # And that edit must name the folder the app is really using.
  [ "$EDIT_DIR" = "$DIR" ] ||
    stop "$COMPOSE_FILE has been edited to use $EDIT_DIR, but the running app is using $DIR. One of them is out of date, and this script won't guess which."
elif [ "$HEAD_USES_VAR" = no ]; then
  # No hand edit: then the file itself must name the folder in use.
  git show "HEAD:$COMPOSE_FILE" | grep -q -- "- $DIR:$TARGET\$" ||
    stop "the running app uses $DIR, but $COMPOSE_FILE names a different folder and has no hand edit. That needs a person to look at."
fi

say "The running app's data folder: $DIR"
say "The database is there:         $DIR/$DB_NAME"

# ── 4–6. Change, then prove it, or put it all back ───────────────────────────
OLD_HEAD=$(git rev-parse HEAD)
BACKUP=$(mktemp -d "${TMPDIR:-/tmp}/move-data-dir.XXXXXX")
chmod 700 "$BACKUP"
cp "$COMPOSE_FILE" "$BACKUP/compose"
cp .env "$BACKUP/env"
cmp -s "$COMPOSE_FILE" "$BACKUP/compose" && cmp -s .env "$BACKUP/env" || stop "couldn't make safety copies in $BACKUP."

PHASE=changing
WHY="it was interrupted"
finish() {
  code=$?
  # From here on, one failed step must not stop the ones after it.
  set +e
  if [ "$PHASE" = changing ]; then
    say ""
    say "PROBLEM: $WHY"
    say "Putting everything back as it was..."
    git reset -q --hard "$OLD_HEAD" </dev/null
    # Plain copies into the existing files: the contents go back, and the
    # files' owner and permissions were never touched. cp reads the saved
    # copy before it writes, so a missing copy can't leave an emptied file.
    cp "$BACKUP/compose" "$COMPOSE_FILE"
    cp "$BACKUP/env" .env
    if cmp -s "$BACKUP/compose" "$COMPOSE_FILE" && cmp -s "$BACKUP/env" .env &&
      [ "$(git rev-parse HEAD)" = "$OLD_HEAD" ]; then
      say "Done: $COMPOSE_FILE and .env are exactly as they were. Nothing was restarted."
      rm -rf "$BACKUP"
    else
      say "COULD NOT put everything back automatically. The originals are saved here:"
      say "  $BACKUP/compose   (this is $COMPOSE_FILE)"
      say "  $BACKUP/env       (this is .env)"
      say "Do not update or restart the app until they are back in place."
    fi
    exit 1
  fi
  rm -rf "$BACKUP"
  exit "$code"
}
trap finish EXIT
trap 'WHY="it was interrupted"; exit 130' INT TERM HUP

# 4. The folder goes into .env (replacing an empty setting, if there was one).
if [ "$CURRENT" != "$DIR" ]; then
  WHY="the new .env couldn't be prepared"
  # Everything that was there (awk 1 also ends a last line that had no
  # line ending, which would otherwise swallow the new one)…
  grep -v "^[[:space:]]*$VAR=" "$BACKUP/env" | awk 1 > "$BACKUP/env.kept"
  # …plus the one new line.
  cp "$BACKUP/env.kept" "$BACKUP/env.new"
  printf '%s=%s\n' "$VAR" "$DIR" >> "$BACKUP/env.new"
  # Proof, before it replaces anything: the new file is the old one with
  # exactly that line added, and nothing lost.
  grep -v "^[[:space:]]*$VAR=" "$BACKUP/env.new" | cmp -s - "$BACKUP/env.kept"
  [ "$(grep -c "^$VAR=" "$BACKUP/env.new")" = 1 ]
  # Copied into the existing file, so its owner and permissions stay.
  WHY="the new .env couldn't be written"
  cp "$BACKUP/env.new" .env
  cmp -s "$BACKUP/env.new" .env
fi

# 5. The hand edit is now redundant; move to the fetched version.
if [ "$EDITED" = yes ]; then
  WHY="the hand edit couldn't be removed"
  git checkout -q -- "$COMPOSE_FILE" </dev/null
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "$NEW^{commit}")" ]; then
  WHY="the fetched version couldn't be applied"
  git merge -q --ff-only "$NEW" </dev/null
fi

# 6. What would docker compose use now?
WHY="docker compose couldn't read the new setup"
if ! compose config > "$BACKUP/config" 2> "$BACKUP/config.err"; then
  WHY="docker compose couldn't read the new setup: $(head -n 5 "$BACKUP/config.err")"
  exit 1
fi
RESOLVED=$(awk -v target="$TARGET" '
  function flush() { if (hit && src != "") { print src; done = 1 } src = ""; hit = 0 }
  done { next }
  /^[[:space:]]*-[[:space:]]/ {
    flush()
    if (done) next
    line = $0
    sub(/^[[:space:]]*-[[:space:]]+/, "", line)
    gsub(/^"|"$/, "", line)
    # short form:  /host/folder:/app/backend/data[:rw]
    n = index(line, ":" target)
    if (n > 1) {
      rest = substr(line, n + length(target) + 1)
      if (rest == "" || rest ~ /^:[A-Za-z,]+$/) { print substr(line, 1, n - 1); done = 1; next }
    }
    # long form, which may begin on the dash line:  - type: bind
    $0 = line
  }
  {
    if ($1 == "source:") src = $2
    if ($1 == "target:" && $2 == target) hit = 1
  }
  END { if (!done) flush() }
' "$BACKUP/config")
if [ "$RESOLVED" != "$DIR" ]; then
  WHY="docker compose would use '${RESOLVED:-nothing it could find}' for the data, not '$DIR'"
  exit 1
fi

PHASE=done
say ""
say "DONE."
say "  Data folder, unchanged:  $DIR"
say "  Now set in .env:         $(grep "^$VAR=" .env | tail -n 1)"
if [ -z "$(git status --porcelain --untracked-files=no)" ]; then
  say "  $COMPOSE_FILE:      identical to the repo's, no hand edits left"
fi
say "  docker compose confirms it would use that same folder."
say "  Nothing was started, stopped or restarted."
