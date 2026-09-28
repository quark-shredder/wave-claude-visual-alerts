#!/bin/bash
# wave-claude-alerts — show Claude Code's state on the Wave Terminal tab.
#
# Called with one argument naming the state. The state arrives as $1, so no
# jq is needed. Only two arguments read the stdin JSON, with sed: `done`, to
# see whether Claude's last message asks you something, and `notify`, which
# routes a Notification to a state by its type.
#
#   busy      spinner              blue    working, no action needed
#   input     hand                 orange  needs a permission decision
#   waiting   circle-question      yellow  Claude or an agent asked you something
#   limit     hourglass-end        yellow  usage limit: press Enter to continue
#   mcp       message-question     purple  an MCP server wants input
#   computer  computer-mouse       teal    Claude is using your mouse and keyboard
#   done      circle-check         green   turn finished
#   failed    triangle-exclamation red     turn died on an API error
#   end       -                    -       session over: clean up
#
# Two objects, deliberately:
#
#   Alerts go on the TAB. Wave clears them itself when you focus the tab
#   (its BadgeAutoClearing component). The one alert cleared here is
#   `computer`, when Claude hands your mouse and keyboard back.
#
#   The busy spinner goes on the BLOCK and is pinned to a sentinel process
#   with --pid, which makes Wave's auto-clear skip it. So it survives focus,
#   and reappears as the main icon once a higher-priority alert clears.
#
#   The sentinel's pid is recorded in ~/.wave-alerts/run/<tabid>.pid. `busy`
#   fires on both UserPromptSubmit and PreToolUse, because a turn started with
#   a `!` bash command never fires UserPromptSubmit and would otherwise run
#   with no spinner at all. PreToolUse fires on every tool call, so the common
#   path must be cheap: a pid file read plus `kill -0` is ~5ms, where `pgrep`
#   alone was 17ms.
#
# Every colour and icon is overridable; see the table in the README.
#
# Installed to: ~/.wave-alerts/hooks/wave-alert-hook.sh
# Run `npx wave-claude-visual-alerts setup` to install/update.

# Not running inside a Wave tab — nothing to show.
[ -n "$WAVETERM_TABID" ] || exit 0

# WAVETERM_TABID is interpolated into a process name and a pkill pattern, so
# require the exact 8-4-4-4-12 UUID shape Wave always sets. A character-class
# check is not enough: values like "-9" are all dashes and digits and would
# pass one, then be read as an option by the tools below.
case "$WAVETERM_TABID" in
  [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) ;;
  *) exit 0 ;;
esac

WSH="$HOME/Library/Application Support/waveterm/bin/wsh"
[ -x "$WSH" ] || WSH="$HOME/.waveterm/bin/wsh"
[ -x "$WSH" ] || WSH=$(command -v wsh 2>/dev/null)
[ -x "$WSH" ] || exit 0

TAB="tab:$WAVETERM_TABID"
SENTINEL="wave-alert-busy-$WAVETERM_TABID"
RUNDIR="$HOME/.wave-alerts/run"
PIDFILE="$RUNDIR/$WAVETERM_TABID.pid"

# Echo the sentinel's pid if it is alive, else fail. This is the hot path.
sentinel_pid() {
  [ -r "$PIDFILE" ] || return 1
  read -r p < "$PIDFILE" 2>/dev/null || return 1
  case "$p" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$p" 2>/dev/null || return 1
  echo "$p"
}

kill_sentinel() {
  p=$(sentinel_pid) || { rm -f "$PIDFILE" 2>/dev/null; return 0; }
  # Pids get recycled, so confirm it is really ours before signalling.
  case "$(ps -o args= -p "$p" 2>/dev/null)" in
    "$SENTINEL"*) kill "$p" 2>/dev/null ;;
  esac
  rm -f "$PIDFILE" 2>/dev/null
}

# alert <icon> <color> [priority]  — on the tab, cleared by Wave on focus
alert() {
  "$WSH" badge "$1" --color "$2" --priority "${3:-10}" -b "$TAB" >/dev/null 2>&1
}

# Does Claude's last message, in the Stop JSON on stdin, end in a question?
# The value is still JSON-escaped, so a trailing newline is the two
# characters \n. Trailing markdown emphasis is stripped too: "**Proceed?**".
asked_question() {
  [ -t 0 ] && return 1
  t=$(sed -nE 's/.*"last_assistant_message":"(([^"\\]|\\.)*)".*/\1/p')
  while :; do
    case "$t" in
      *'\n') t=${t%'\n'} ;;
      *' '|*'*'|*'_'|*'`') t=${t%?} ;;
      *) break ;;
    esac
  done
  case "$t" in *'?') return 0 ;; esac
  return 1
}

state=$1

# One Notification registration covers several types; route each to a state.
if [ "$state" = notify ]; then
  [ -t 0 ] && exit 0
  type=$(sed -nE 's/.*"notification_type":"([a-z_]*)".*/\1/p')
  case "$type" in
    agent_needs_input)          state=waiting ;;
    worker_permission_prompt)   state=input ;;
    quota_auto_resume_fired)    state=busy ;;
    quota_auto_resume_stale|quota_auto_resume_disabled) state=limit ;;
    computer_use_enter)         state=computer ;;
    computer_use_exit)
      "$WSH" badge --clear -b "$TAB" >/dev/null 2>&1
      exit 0 ;;
    *) exit 0 ;;
  esac
fi

case "$state" in
  busy)
    # Already spinning: leave it alone. Never kill-and-respawn here — Wave
    # clears badges by oref rather than badge id, and does it asynchronously
    # when a watched pid dies, so a kill would race the new badge and wipe it.
    sentinel_pid >/dev/null && exit 0
    mkdir -p "$RUNDIR" 2>/dev/null
    # $SENTINEL is passed as an argument, never interpolated into the code
    nohup bash -c 'exec -a "$1" sleep 86400' _ "$SENTINEL" >/dev/null 2>&1 &
    pid=$!
    echo "$pid" > "$PIDFILE" 2>/dev/null
    "$WSH" badge "${WAVE_ALERT_ICON_BUSY:-spinner+spin}" \
           --color "${WAVE_ALERT_COLOR_BUSY:-#429DFF}" --pid "$pid" >/dev/null 2>&1
    ;;
  input)
    alert "${WAVE_ALERT_ICON_INPUT:-hand+beat}" "${WAVE_ALERT_COLOR_INPUT:-#FF9500}"
    ;;
  waiting)
    alert "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    ;;
  limit)
    alert "${WAVE_ALERT_ICON_LIMIT:-hourglass-end+fade}" "${WAVE_ALERT_COLOR_LIMIT:-#FFE900}"
    ;;
  mcp)
    alert "${WAVE_ALERT_ICON_MCP:-message-question+beat}" "${WAVE_ALERT_COLOR_MCP:-#BF55EC}"
    ;;
  computer)
    alert "${WAVE_ALERT_ICON_COMPUTER:-computer-mouse}" "${WAVE_ALERT_COLOR_COMPUTER:-#00FFDB}"
    ;;
  done)
    kill_sentinel
    if asked_question; then
      alert "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    else
      alert "${WAVE_ALERT_ICON_DONE:-circle-check}" "${WAVE_ALERT_COLOR_DONE:-#58C142}"
    fi
    ;;
  failed)
    kill_sentinel
    alert "${WAVE_ALERT_ICON_FAILED:-triangle-exclamation+beat}" "${WAVE_ALERT_COLOR_FAILED:-#FF453A}" 15
    ;;
  end)
    kill_sentinel
    "$WSH" badge --clear >/dev/null 2>&1
    "$WSH" badge --clear -b "$TAB" >/dev/null 2>&1
    ;;
esac

exit 0
