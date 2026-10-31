#!/bin/bash
# wave-claude-alerts — show Claude Code's state on the Wave Terminal tab.
#
# Called with one argument naming the state. The state arrives as $1, so no
# jq is needed. Only two arguments read the stdin JSON, with sed: `done`, to
# see whether Claude's last message asks you something, and `notify`, which
# routes a Notification to a state by its type.
#
#   session   wave-pulse           teal    a Claude session is live here, not yet used
#   busy      spinner              blue    working, no action needed
#   input     hand                 orange  needs a permission decision
#   waiting   circle-question      yellow  Claude or an agent asked you something
#   limit     hourglass-end        yellow  usage limit: press Enter to continue
#   mcp       message-question     orange  an MCP server wants input
#   computer  computer-mouse       blue    Claude is using your mouse and keyboard
#   done      circle-check         green   turn finished (waiting, if it ends in "?")
#   failed    triangle-exclamation red     turn died on an API error
#   end       -                    -       session over: clean up
#
# One badge, always the current state. Wave draws a tab's top badge as its
# icon and the next two as 4 px dots, with no way to turn the dots off, so a
# second badge always means a dot. Everything therefore goes on the BLOCK, in
# one badge pinned to Claude's own pid with --pid. Pinned badges are skipped
# by Wave's clear-on-focus, so a state holds until the next state replaces
# it: an unanswered permission stays up even after you look at the tab. Wave
# removes the badge itself within a second of Claude exiting, even on a crash.
#
# Wave only lets a badge replace one of lower priority, or of equal priority
# and older. Every active state is 5, so the newest simply wins. The two
# idle states, session and done, are -1, just under a manual flag's 0, so
# going idle is a clear then a set. A pid exit clears by badge id, so it never wipes a newer badge.
#
# A waiting state ends on the event that resolves it, all mapped to `busy`:
# PostToolUse/PostToolUseFailure after a permission or AskUserQuestion is
# answered, ElicitationResult after MCP input, UserPromptSubmit after you
# reply. `busy` also fires on every PreToolUse, because a turn started with a
# `!` bash command never fires UserPromptSubmit. So the already-spinning
# check is the hot path: one read of ~/.wave-alerts/run/<blockid>.state,
# compared against the hook's parent pid.
#
# Every colour and icon is overridable; see the table in the README.
#
# Installed to: ~/.wave-alerts/hooks/wave-alert-hook.sh
# Run `npx wave-claude-visual-alerts setup` to install/update.

# Not running inside a Wave tab — nothing to show.
[ -n "$WAVETERM_TABID" ] || exit 0

# Wave ids are interpolated into file paths and badge targets, so require the
# exact 8-4-4-4-12 UUID shape Wave always sets. A character-class check is not
# enough: values like "-9" are all dashes and digits and would pass one, then
# be read as an option by the tools below.
is_uuid() {
  case "$1" in
    [0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]-[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]) return 0 ;;
  esac
  return 1
}
is_uuid "$WAVETERM_TABID" || exit 0

WSH="$HOME/Library/Application Support/waveterm/bin/wsh"
[ -x "$WSH" ] || WSH="$HOME/.waveterm/bin/wsh"
[ -x "$WSH" ] || WSH=$(command -v wsh 2>/dev/null)
[ -x "$WSH" ] || exit 0

TAB="tab:$WAVETERM_TABID"
RUNDIR="$HOME/.wave-alerts/run"
# The badge lives on the block, so no block id means nothing to show.
is_uuid "$WAVETERM_BLOCKID" || exit 0
BLOCK="block:$WAVETERM_BLOCKID"
STATEFILE="$RUNDIR/$WAVETERM_BLOCKID.state"

# Claude Code runs this hook as its direct child, so $PPID is Claude. If a
# shell sits in between, step past it.
claude_pid() {
  p=$PPID
  case "$(ps -o comm= -p "$p" 2>/dev/null)" in
    *sh) p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ') ;;
  esac
  echo "$p"
}

# show <state> <icon> <color> [priority]  — the block's one badge, pinned to
# Claude's pid. Priority 5 for every active state, so the newest wins.
show() {
  "$WSH" badge "$2" --color "$3" --pid "$(claude_pid)" --priority="${4:-5}" -b "$BLOCK" >/dev/null 2>&1
  mkdir -p "$RUNDIR" 2>/dev/null
  echo "$1:$PPID" > "$STATEFILE" 2>/dev/null
}

# show_idle <state> <icon> <color>  — below every active state, so clear first.
show_idle() {
  "$WSH" badge --clear -b "$BLOCK" >/dev/null 2>&1
  show "$1" "$2" "$3" -1
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
    computer_use_exit)          state=busy ;;
    *) exit 0 ;;
  esac
fi

case "$state" in
  session)
    show_idle idle "${WAVE_ALERT_ICON_SESSION:-wave-pulse+fade}" "${WAVE_ALERT_COLOR_SESSION:-#00FFDB}"
    ;;
  busy)
    # Already spinning for this Claude: the hot path, one file read.
    read -r s 2>/dev/null < "$STATEFILE"
    [ "$s" = "busy:$PPID" ] && exit 0
    show busy "${WAVE_ALERT_ICON_BUSY:-spinner+spin}" "${WAVE_ALERT_COLOR_BUSY:-#429DFF}"
    ;;
  input)
    show input "${WAVE_ALERT_ICON_INPUT:-hand+beat}" "${WAVE_ALERT_COLOR_INPUT:-#FF9500}"
    ;;
  waiting)
    show waiting "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    ;;
  limit)
    show limit "${WAVE_ALERT_ICON_LIMIT:-hourglass-end+fade}" "${WAVE_ALERT_COLOR_LIMIT:-#FFE900}"
    ;;
  mcp)
    show mcp "${WAVE_ALERT_ICON_MCP:-message-question+beat}" "${WAVE_ALERT_COLOR_MCP:-#FF9500}"
    ;;
  computer)
    show computer "${WAVE_ALERT_ICON_COMPUTER:-computer-mouse}" "${WAVE_ALERT_COLOR_COMPUTER:-#429DFF}"
    ;;
  done)
    if asked_question; then
      show waiting "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    else
      show_idle done "${WAVE_ALERT_ICON_DONE:-circle-check}" "${WAVE_ALERT_COLOR_DONE:-#58C142}"
    fi
    ;;
  failed)
    show failed "${WAVE_ALERT_ICON_FAILED:-triangle-exclamation+beat}" "${WAVE_ALERT_COLOR_FAILED:-#FF453A}"
    ;;
  end)
    "$WSH" badge --clear -b "$BLOCK" >/dev/null 2>&1
    rm -f "$STATEFILE" 2>/dev/null
    # Tab alerts from versions before 1.4.0, if any are still up.
    "$WSH" badge --clear -b "$TAB" >/dev/null 2>&1
    ;;
esac

exit 0
