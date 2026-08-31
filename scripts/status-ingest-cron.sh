#!/bin/sh
#
# Runs the status ingest from cron.
#
# The wrapper exists because cron is not a shell you have logged into. It starts
# with almost no environment: PATH is typically /usr/bin:/bin and nothing else,
# the working directory is $HOME, and anything printed goes to a mail spool that
# on this machine does not exist. Each of those turns a working command into one
# that fails silently at 00:15 and is noticed weeks later, so each is handled
# here rather than crammed into a crontab line.
#
# Install (from the project directory on the VM):
#
#   chmod +x scripts/status-ingest-cron.sh
#   crontab -e
#
# then add these two lines -- the first is not a comment and is required:
#
#   CRON_TZ=Asia/Taipei
#   15 0,6,12,18 * * * /full/path/to/scripts/status-ingest-cron.sh
#
# Without CRON_TZ the schedule is read in the machine's timezone, which on a GCP
# VM is UTC, and 00:15 lands at 08:15 Taipei.

set -eu

# Resolve the project from this script's own location, so the crontab entry does
# not have to be edited if the project moves.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname -- "$SCRIPT_DIR")
cd "$PROJECT_DIR"

# cron's PATH usually lacks whatever installed node. Look where it actually
# tends to be, including nvm, which installs per-version under $HOME.
PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  for candidate in /usr/local/bin/node /usr/bin/node "$HOME"/.nvm/versions/node/*/bin/node; do
    if [ -x "$candidate" ]; then
      PATH="$(dirname -- "$candidate"):$PATH"
      break
    fi
  done
fi
export PATH

LOG_DIR="$PROJECT_DIR/data/logs"
LOG_FILE="$LOG_DIR/status-ingest.log"
mkdir -p "$LOG_DIR"

# Four runs a day of roughly twenty lines each fills a disk slowly but it does
# fill one, and this VM does not have much. Keep the recent half and drop the
# rest -- the mailbox still holds every batch, so the log is a convenience.
MAX_BYTES=1048576
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$MAX_BYTES" ]; then
  tail -c $((MAX_BYTES / 2)) "$LOG_FILE" > "$LOG_FILE.trimmed"
  mv "$LOG_FILE.trimmed" "$LOG_FILE"
fi

run() {
  echo ""
  # TZ on the date call only, not exported. CRON_TZ decides when cron fires; it
  # does not change the machine's clock, which on this VM is UTC -- so a job set
  # for 00:15 Taipei logs itself at 16:15 and reads like it ran at the wrong
  # time. Scoping it here keeps the log in the timezone the schedule was written
  # in, while node still runs in UTC like the server process it shares a
  # database with.
  echo "===== $(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %Z') ====="
  # set +e around the call, and the status captured on its own line. Written as
  # `if ! node ...; then echo $?` the reported code is the negation's, which is
  # always 0 -- a failure log that says the run succeeded.
  set +e
  node --use-system-ca --import tsx scripts/status-ingest.ts
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    echo "✗ 這次執行失敗（結束碼 $status）"
  fi
}

# If a run ever hangs, the next one must not pile on top of it -- two processes
# importing the same batch is exactly the double-count the sequence guard exists
# to prevent, and there is no reason to lean on it here. flock is not installed
# everywhere, so its absence is a reason to run anyway, not to skip the job.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOG_DIR/status-ingest.lock"
  if ! flock -n 9; then
    echo "$(TZ=Asia/Taipei date '+%Y-%m-%d %H:%M:%S %Z') 上一次還在執行，這次跳過" >> "$LOG_FILE"
    exit 0
  fi
fi

run >> "$LOG_FILE" 2>&1
