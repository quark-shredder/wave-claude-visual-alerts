# wave-claude-visual-alerts

Flags the [Wave Terminal](https://waveterm.dev) tab when [Claude Code](https://claude.ai/claude-code) needs your input or finishes a task. The flag clears itself the moment you focus the tab.

Built for the case where you have eight or more Wave tabs open and need to know *which one* wants you.

## Quick Start

```bash
npx wave-claude-visual-alerts setup
```

Then restart Claude Code.

## What It Does

Two events, one flag icon in the tab bar:

| Alert | Color | Fires on | Meaning |
|-------|-------|----------|---------|
| 🟠 Orange flag | `#FF9500` | `PermissionRequest` | Claude needs a permission decision |
| 🟦 Teal flag | `#00FFDB` | `Stop` | Claude finished the turn |

**Clearing is not our job.** Wave ≥ 0.14.2 ships a `BadgeAutoClearing` component that removes a tab badge about 500 ms after you focus that tab (3 s if you were already sitting on it). So there are no clear-hooks, no state directory, and no way for a stale flag to get stuck.

## Plays Nicely With Manually Flagged Tabs

If you use Wave's **Flag Tab** right-click menu to colour-code your tabs, this tool will not disturb it. It never writes `tab:flagcolor`.

Wave renders your manual flag as a synthetic badge at `priority: 0` and merges it with real badges, sorted highest-priority-first. Alert badges default to `priority: 10`, so:

- **Normally** — your manual flag owns the 12 px icon slot.
- **During an alert** — the alert flag takes the main slot; your colour demotes to a 4 px dot beside it.
- **After it clears** — your manual flag returns to the main slot, untouched.

Override and restore, with nothing saved or written back.

## Commands

```bash
npx wave-claude-visual-alerts setup      # Install hook + register in settings.json
npx wave-claude-visual-alerts uninstall  # Deregister + remove hook
npx wave-claude-visual-alerts doctor     # Check wsh, hook script, registration
npx wave-claude-visual-alerts test       # Show the flag on this tab for 20s
```

`test` pins the badge to a short-lived pid so auto-clear skips it — otherwise you could never see an alert on the tab you are looking at.

## Requirements

- [Wave Terminal](https://waveterm.dev) **v0.14.2+** (needs badge auto-clearing)
- [Claude Code](https://claude.ai/claude-code) v2.x (needs the `PermissionRequest` event)
- Node.js 18+

No `jq`. No config file.

## Customization

Two environment variables, read at hook time:

```bash
export WAVE_ALERT_COLOR_INPUT="#FF453A"   # permission needed
export WAVE_ALERT_COLOR_DONE="#58C142"    # task done
```

Defaults are orange and teal — two entries from Wave's own flag palette that are easy to tell apart from the green/blue/purple most people use for manual tab flags. Any hex (`#RRGGBB`, `#RRGGBBAA`) or CSS colour name works.

## How It Works

`setup` writes `~/.wave-alerts/hooks/wave-alert-hook.sh` and registers it in `~/.claude/settings.json` for two events. The event name is passed as an **argument** rather than parsed from the stdin JSON, which is why the hook needs no `jq`:

```json
{
  "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command",
      "command": "~/.wave-alerts/hooks/wave-alert-hook.sh input", "timeout": 3 }] }],
  "Stop": [{ "hooks": [{ "type": "command",
      "command": "~/.wave-alerts/hooks/wave-alert-hook.sh done", "timeout": 3 }] }]
}
```

The hook is ~20 lines of logic. It reads `WAVETERM_TABID` from the environment, exits silently if unset (so it is harmless outside Wave), and runs:

```bash
wsh badge flag --color "$color" -b "tab:$WAVETERM_TABID"
```

The badge is set on the **tab** rather than the block, so focusing the tab clears it no matter which pane inside is focused.

### Known limitation

One badge exists per tab, so two Claude sessions in the *same* tab share one flag and the most recent event wins. One session per tab — the usual layout — is unaffected.

## Coexistence

`setup` only adds and removes its own entries, matched by the `wave-alert-hook` filename, and backs up `settings.json` first. Other hooks are never touched.

## Troubleshooting

Run `npx wave-claude-visual-alerts doctor`.

**No flag appears?** Confirm `echo $WAVETERM_TABID` is non-empty in the Claude Code pane. Hooks inherit the shell environment, so a Claude Code started outside Wave will not have it.

**Flag vanishes too quickly?** Expected on the tab you are already viewing — Wave clears it after 3 s. On inactive tabs it persists until you switch there.

## License

MIT
