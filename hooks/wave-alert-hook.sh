#!/bin/bash
# wave-claude-alerts — show Claude Code's state on the Wave Terminal tab.
#
# Called with one argument naming the state. The state arrives as $1, so no
# jq is needed. Only two arguments read the stdin JSON, with sed: `done`, to
# see whether Claude's last message asks you something, and `notify`, which
# routes a Notification to a state by its type.
#
#   session   wave-pulse           teal    a Claude session is open here, idle
#   busy      spinner              blue    working, no action needed
#   input     hand                 orange  needs a permission decision
#   waiting   circle-question      yellow  Claude or an agent asked you something
#   limit     hourglass-end        yellow  usage limit: press Enter to continue
#   mcp       message-question     orange  an MCP server wants input
#   computer  computer-mouse       blue    Claude is using your mouse and keyboard
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
#   The BLOCK holds one always-on badge for as long as Claude runs: the
#   session indicator when idle, the spinner while working. Both are pinned
#   to Claude's own pid with --pid, which makes Wave's auto-clear skip them,
#   and makes Wave remove them itself within a second of Claude exiting, even
#   on a crash. They reappear as the main icon once a tab alert clears.
#
#   Wave only lets a badge replace one of lower priority, or of equal priority
#   and older. The spinner (5) outranks the session indicator (-1, just under
#   a manual flag's 0), so going busy is one set, and going idle is a clear
#   then a set. A pid exit clears by badge id, so it never wipes a newer badge.
#
#   `busy` fires on both UserPromptSubmit and PreToolUse, because a turn
#   started with a `!` bash command never fires UserPromptSubmit. PreToolUse
#   fires on every tool call, so the already-spinning check is one read of
#   ~/.wave-alerts/run/<blockid>.state, compared against the hook's parent pid.
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
# The block badge needs the block id; without it, only tab alerts are shown.
BLOCK=""
STATEFILE=""
if is_uuid "$WAVETERM_BLOCKID"; then
  BLOCK="block:$WAVETERM_BLOCKID"
  STATEFILE="$RUNDIR/$WAVETERM_BLOCKID.state"
fi

# Claude Code runs this hook as its direct child, so $PPID is Claude. If a
# shell sits in between, step past it.
claude_pid() {
  p=$PPID
  case "$(ps -o comm= -p "$p" 2>/dev/null)" in
    *sh) p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ') ;;
  esac
  echo "$p"
}

# block_badge <state> <icon> <color> <priority>  — pinned to Claude's pid
block_badge() {
  "$WSH" badge "$2" --color "$3" --pid "$(claude_pid)" --priority="$4" -b "$BLOCK" >/dev/null 2>&1
  mkdir -p "$RUNDIR" 2>/dev/null
  echo "$1:$PPID" > "$STATEFILE" 2>/dev/null
}

# The always-on indicator. Clear first: the spinner outranks it.
show_session() {
  [ -n "$BLOCK" ] || return 0
  "$WSH" badge --clear -b "$BLOCK" >/dev/null 2>&1
  block_badge idle "${WAVE_ALERT_ICON_SESSION:-wave-pulse+fade}" "${WAVE_ALERT_COLOR_SESSION:-#00FFDB}" -1
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
  session)
    show_session
    ;;
  busy)
    [ -n "$BLOCK" ] || exit 0
    # Already spinning for this Claude: the hot path, one file read.
    read -r s 2>/dev/null < "$STATEFILE"
    [ "$s" = "busy:$PPID" ] && exit 0
    block_badge busy "${WAVE_ALERT_ICON_BUSY:-spinner+spin}" "${WAVE_ALERT_COLOR_BUSY:-#429DFF}" 5
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
    alert "${WAVE_ALERT_ICON_MCP:-message-question+beat}" "${WAVE_ALERT_COLOR_MCP:-#FF9500}"
    ;;
  computer)
    alert "${WAVE_ALERT_ICON_COMPUTER:-computer-mouse}" "${WAVE_ALERT_COLOR_COMPUTER:-#429DFF}"
    ;;
  done)
    show_session
    if asked_question; then
      alert "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    else
      alert "${WAVE_ALERT_ICON_DONE:-circle-check}" "${WAVE_ALERT_COLOR_DONE:-#58C142}"
    fi
    ;;
  failed)
    show_session
    alert "${WAVE_ALERT_ICON_FAILED:-triangle-exclamation+beat}" "${WAVE_ALERT_COLOR_FAILED:-#FF453A}" 15
    ;;
  end)
    [ -n "$BLOCK" ] && "$WSH" badge --clear -b "$BLOCK" >/dev/null 2>&1
    [ -n "$STATEFILE" ] && rm -f "$STATEFILE" 2>/dev/null
    "$WSH" badge --clear -b "$TAB" >/dev/null 2>&1
    ;;
esac

exit 0
