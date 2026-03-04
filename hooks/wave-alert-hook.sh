#!/bin/bash
# wave-claude-visual-alerts — Visual alerts for Claude Code in Wave Terminal
# https://github.com/quark-shredder/wave-claude-visual-alerts
#
# Priority-based alert system with fallback across blocks/tabs.
#
# Levels:
#   Block border  → wsh setmeta (own block only)
#   Tab indicator → wsh tabindicator --tabid (cross-tab capable)
#   Tab background→ wsh setbg (own tab only)
#
# State dir: /tmp/wave-alerts/{tabid}/{blockid}
# State format: "state|color|priority"
#
# Priority: permission(4) > stop(1)
#
# Installed to: ~/.wave-alerts/hooks/wave-alert-hook.sh
# Run `npx wave-claude-visual-alerts setup` to install/update this hook.

set -e

# ─── Find wsh (cross-platform) ───

if [ -x "$HOME/Library/Application Support/waveterm/bin/wsh" ]; then
  WSH="$HOME/Library/Application Support/waveterm/bin/wsh"
elif [ -x "$HOME/.waveterm/bin/wsh" ]; then
  WSH="$HOME/.waveterm/bin/wsh"
elif command -v wsh >/dev/null 2>&1; then
  WSH=$(command -v wsh)
else
  exit 0
fi

# ─── Find jq ───

JQ=$(command -v jq 2>/dev/null || echo "")
[ -z "$JQ" ] && [ -x "/opt/homebrew/bin/jq" ] && JQ="/opt/homebrew/bin/jq"
[ -z "$JQ" ] && [ -x "/usr/local/bin/jq" ] && JQ="/usr/local/bin/jq"
[ -z "$JQ" ] && [ -x "/usr/bin/jq" ] && JQ="/usr/bin/jq"
[ -x "$JQ" ] || exit 0

# ─── Configuration ───

CONFIG_FILE="$HOME/.wave-alerts/config.json"

# Defaults (vibrant theme)
COLOR_STOP="#AB47BC"
COLOR_PERMISSION="#00BCD4"
BG_OPACITY="0.10"
BG_ENABLED="true"

if [ -f "$CONFIG_FILE" ]; then
  # Apply theme first (base colors)
  THEME=$("$JQ" -r '.theme // ""' "$CONFIG_FILE" 2>/dev/null)
  case "$THEME" in
    nord)
      COLOR_STOP="#B48EAD"; COLOR_PERMISSION="#EBCB8B" ;;
    light)
      COLOR_STOP="#0277BD"; COLOR_PERMISSION="#9E9D24" ;;
  esac

  # Per-color overrides (on top of theme)
  c=$("$JQ" -r '.colors.stop // ""' "$CONFIG_FILE" 2>/dev/null)
  [ -n "$c" ] && COLOR_STOP="$c"
  c=$("$JQ" -r '.colors.permission // ""' "$CONFIG_FILE" 2>/dev/null)
  [ -n "$c" ] && COLOR_PERMISSION="$c"

  # Background settings
  BG_OPACITY=$("$JQ" -r '.bgOpacity // "0.10"' "$CONFIG_FILE" 2>/dev/null)
  BG_ENABLED=$("$JQ" -r '.bgEnabled // "true"' "$CONFIG_FILE" 2>/dev/null)
fi

# ─── Read input ───

input=$(cat)
event=$("$JQ" -r '.hook_event_name // "unknown"' <<< "$input")

TABID="${WAVETERM_TABID:-unknown}"
BLOCKID="${WAVETERM_BLOCKID:-unknown}"
ALERT_DIR="/tmp/wave-alerts"
TAB_DIR="$ALERT_DIR/$TABID"
STATE_FILE="$TAB_DIR/$BLOCKID"

# ─── Recalculate functions ───

highest_in_dir() {
  local dir="$1"
  local best_color="" best_pri=0
  [ -d "$dir" ] || return 0
  for f in "$dir"/*; do
    [ -f "$f" ] || continue
    IFS='|' read -r _state color pri < "$f" 2>/dev/null || continue
    if [ "${pri:-0}" -gt "$best_pri" ]; then
      best_pri="$pri"
      best_color="$color"
    fi
  done
  [ -n "$best_color" ] && echo "$best_color|$best_pri"
}

recalc_tab_indicator() {
  local tabid="$1"
  local result
  result=$(highest_in_dir "$ALERT_DIR/$tabid")
  if [ -n "$result" ]; then
    local color="${result%%|*}"
    "$WSH" tabindicator --persistent --color "$color" --tabid "$tabid" 2>/dev/null || true
  else
    "$WSH" tabindicator --clear --tabid "$tabid" 2>/dev/null || true
  fi
}

recalc_tab_bg() {
  [ "$BG_ENABLED" = "true" ] || return 0
  local result
  result=$(highest_in_dir "$TAB_DIR")
  if [ -n "$result" ]; then
    local color="${result%%|*}"
    "$WSH" setbg --opacity "$BG_OPACITY" "$color" 2>/dev/null || true
  else
    "$WSH" setbg --clear 2>/dev/null || true
  fi
}

recalc_all_tabs() {
  [ -d "$ALERT_DIR" ] || return 0
  for tabdir in "$ALERT_DIR"/*/; do
    [ -d "$tabdir" ] || continue
    local tid
    tid=$(basename "$tabdir")
    recalc_tab_indicator "$tid"
  done
}

# ─── Set / Clear functions ───

set_border() {
  local color="$1"
  local state="$2"
  local priority="$3"

  "$WSH" setmeta "frame:activebordercolor=$color" "frame:bordercolor=$color" 2>/dev/null || true

  mkdir -p "$TAB_DIR"
  echo "${state}|${color}|${priority}" > "$STATE_FILE"

  recalc_all_tabs
  recalc_tab_bg
}

clear_border() {
  "$WSH" setmeta "frame:activebordercolor=" "frame:bordercolor=" 2>/dev/null || true

  rm -f "$STATE_FILE" 2>/dev/null || true
  rmdir "$TAB_DIR" 2>/dev/null || true

  recalc_tab_indicator "$TABID"
  recalc_tab_bg
}

# ─── Stale cleanup (SessionStart) ───

cleanup_stale() {
  rm -f "$STATE_FILE" 2>/dev/null || true
  find "$ALERT_DIR" -type f -mmin +60 -delete 2>/dev/null || true
  find "$ALERT_DIR" -type d -empty -delete 2>/dev/null || true
}

# ─── Event handling ───

case "$event" in
  Stop)
    set_border "$COLOR_STOP" "stop" "1"
    ;;
  PreToolUse)
    [ -f "$STATE_FILE" ] && clear_border
    ;;
  PermissionRequest)
    set_border "$COLOR_PERMISSION" "permission" "4"
    ;;
  PostToolUse|PostToolUseFailure)
    [ -f "$STATE_FILE" ] && clear_border
    ;;
  UserPromptSubmit|SessionEnd)
    clear_border
    ;;
  SessionStart)
    cleanup_stale
    ;;
esac

exit 0
