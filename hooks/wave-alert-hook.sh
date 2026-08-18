#!/bin/bash
# wave-claude-alerts — flag the Wave Terminal tab when Claude wants you.
#
#   $1 = input   ->  orange flag  (Claude needs a permission decision)
#   $1 = done    ->  teal flag    (Claude finished the turn)
#
# The event name comes in as $1 rather than from the stdin JSON, so this
# script needs no jq and no parsing.
#
# Wave clears the badge by itself once you focus the tab (its BadgeAutoClearing
# component, Wave >= 0.14.2), so there is deliberately nothing to clear here
# and no state is kept anywhere.
#
# Colors default to two unused entries from Wave's own flag palette so they
# don't collide with tabs you've flagged by hand. Override colors with
# WAVE_ALERT_COLOR_INPUT / WAVE_ALERT_COLOR_DONE and the icon with
# WAVE_ALERT_ICON_INPUT / WAVE_ALERT_ICON_DONE (any Font Awesome 6 name,
# optionally suffixed +beat, +fade, +spin).
#
# Installed to: ~/.wave-alerts/hooks/wave-alert-hook.sh
# Run `npx wave-claude-visual-alerts setup` to install/update.

# Not running inside a Wave tab — nothing to flag.
[ -n "$WAVETERM_TABID" ] || exit 0

WSH="$HOME/Library/Application Support/waveterm/bin/wsh"
[ -x "$WSH" ] || WSH="$HOME/.waveterm/bin/wsh"
[ -x "$WSH" ] || WSH=$(command -v wsh 2>/dev/null)
[ -x "$WSH" ] || exit 0

case "$1" in
  input) color="${WAVE_ALERT_COLOR_INPUT:-#FF9500}"; icon="${WAVE_ALERT_ICON_INPUT:-flag}" ;;
  done)  color="${WAVE_ALERT_COLOR_DONE:-#00FFDB}";  icon="${WAVE_ALERT_ICON_DONE:-flag}" ;;
  *)     exit 0 ;;
esac

"$WSH" badge "$icon" --color "$color" -b "tab:$WAVETERM_TABID" >/dev/null 2>&1
exit 0
