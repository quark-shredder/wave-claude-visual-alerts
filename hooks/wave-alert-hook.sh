#!/bin/bash
# wave-claude-alerts — show Claude Code's state on the Wave Terminal tab.
#
# Called with one argument naming the state. The event name arrives as $1
# rather than from the stdin JSON, so this script needs no jq and no parsing.
#
#   busy      spinner              blue    working, no action needed
#   input     hand                 orange  needs a permission decision
#   waiting   circle-question      yellow  idle, waiting on you
#   mcp       message-question     purple  an MCP server wants input
#   done      circle-check         green   turn finished
#   failed    triangle-exclamation red     turn died on an API error
#   end       -                    -       session over: clean up
#
# Two objects, deliberately:
#
#   Alerts go on the TAB. Wave clears them itself when you focus the tab
#   (its BadgeAutoClearing component), so nothing here ever clears them.
#
#   The busy spinner goes on the BLOCK and is pinned to a sentinel process
#   with --pid, which makes Wave's auto-clear skip it. So it survives focus,
#   and reappears as the main icon once a higher-priority alert clears.
#   The sentinel is located by process name, so no state files are kept.
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

kill_sentinel() { pkill -f -- "$SENTINEL" 2>/dev/null; }

# alert <icon> <color> [priority]  — on the tab, cleared by Wave on focus
alert() {
  "$WSH" badge "$1" --color "$2" --priority "${3:-10}" -b "$TAB" >/dev/null 2>&1
}

case "$1" in
  busy)
    # Reuse a live sentinel rather than kill-and-respawn. Wave clears badges by
    # oref, not by badge id, and does so asynchronously when a watched pid dies
    # — so killing the old sentinel here would race the new badge and wipe it,
    # leaving a running sentinel with nothing displayed.
    pid=$(pgrep -f -- "$SENTINEL" 2>/dev/null | head -1)
    if [ -z "$pid" ]; then
      # $SENTINEL is passed as an argument, never interpolated into the code
      nohup bash -c 'exec -a "$1" sleep 86400' _ "$SENTINEL" >/dev/null 2>&1 &
      pid=$!
    fi
    "$WSH" badge "${WAVE_ALERT_ICON_BUSY:-spinner+spin}" \
           --color "${WAVE_ALERT_COLOR_BUSY:-#429DFF}" --pid "$pid" >/dev/null 2>&1
    ;;
  input)
    alert "${WAVE_ALERT_ICON_INPUT:-hand+beat}" "${WAVE_ALERT_COLOR_INPUT:-#FF9500}"
    ;;
  waiting)
    alert "${WAVE_ALERT_ICON_WAITING:-circle-question+fade}" "${WAVE_ALERT_COLOR_WAITING:-#FFE900}"
    ;;
  mcp)
    alert "${WAVE_ALERT_ICON_MCP:-message-question+beat}" "${WAVE_ALERT_COLOR_MCP:-#BF55EC}"
    ;;
  done)
    kill_sentinel
    alert "${WAVE_ALERT_ICON_DONE:-circle-check}" "${WAVE_ALERT_COLOR_DONE:-#58C142}"
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
