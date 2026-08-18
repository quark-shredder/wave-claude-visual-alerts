# wave-claude-visual-alerts

Turns the [Wave Terminal](https://waveterm.dev) tab bar into a live status board for [Claude Code](https://claude.ai/claude-code). At a glance you can see which tabs are working, which are finished, and which are blocked waiting on you.

Built for the case where you have eight or more Wave tabs open and need to know *which one* wants you.

## Quick Start

```bash
npx wave-claude-visual-alerts setup
npx wave-claude-visual-alerts test   # cycle every state so you can see them
```

No restart needed — Claude Code hot-reloads `settings.json`.

## The Scheme

**Colour carries urgency. Animation carries kind.**

| Colour | Meaning | | Animation | Meaning |
|---|---|---|---|---|
| 🟡 Yellow | Working, no action needed | | `+spin` | An ongoing process |
| 🟠 Orange | Blocked on you | | `+beat` | Needs you now |
| 🟢 Green | Finished cleanly | | `+fade` | Waiting, passive |
| 🔴 Red | Failed | | *(static)* | Happened, no rush |
| 🟣 Purple | External input needed | | | |
| 🔵 Blue | Informational | | | |

The point is that a working tab should never compete for attention with one that is actually blocked. Only four states move, and all four mean Claude has stopped and is waiting.

## States

| State | Claude Code event | Icon | Colour | Meaning |
|---|---|---|---|---|
| `busy` | `UserPromptSubmit` | `spinner+spin` | 🟡 `#FFE900` | Claude is working |
| `input` | `PermissionRequest` | `hand+beat` | 🟠 `#FF9500` | Needs a permission decision |
| `waiting` | `Notification` | `circle-question+fade` | 🟠 `#FF9500` | Idle, waiting on you |
| `mcp` | `Elicitation` | `message-question+beat` | 🟣 `#BF55EC` | An MCP server wants input |
| `done` | `Stop` | `circle-check` | 🟢 `#58C142` | Turn finished |
| `failed` | `StopFailure` | `triangle-exclamation+beat` | 🔴 `#FF453A` | Turn died on an API error |
| `subagent` | `SubagentStop` | `robot` | 🔵 `#429DFF` | A subagent finished |
| `end` | `SessionEnd` | — | — | Session over; clears everything |

`Notification` is matched on `idle_prompt|agent_needs_input` so ordinary notifications don't trigger it.

## Why Two Objects

Wave allows **one badge per object**, so a naive implementation has every state overwrite the last. This uses two objects deliberately:

- **Alerts go on the tab.** Wave ≥ 0.14.2 ships a `BadgeAutoClearing` component that removes a tab badge ~500 ms after you focus that tab (3 s if you were already there). So there are no clear-hooks, no state directory, and no way for a stale alert to stick.
- **The busy spinner goes on the block**, pinned to a sentinel process via `wsh badge --pid`. Pid-linked badges are explicitly skipped by auto-clear, so the spinner survives you looking at the tab — and reappears as the main icon once a higher-priority alert clears.

The sentinel is located by process name (`exec -a`), so **no state files are written anywhere**. `Stop`, `StopFailure` and `SessionEnd` all kill it.

Badges sort by priority, highest first. Alerts are 10 (failures 15, subagent 6); the pid-linked spinner defaults to 5. So an alert takes the 12 px icon slot and the spinner demotes to a 4 px dot beside it, then returns when the alert clears.

## Plays Nicely With Manually Flagged Tabs

If you use Wave's **Flag Tab** right-click menu to colour-code tabs, this never disturbs it — it does not write `tab:flagcolor`. Wave merges your manual flag as a synthetic `priority: 0` badge, so alerts outrank it, and it returns to the main slot once they clear.

## Commands

```bash
npx wave-claude-visual-alerts setup      # Install hook + register in settings.json
npx wave-claude-visual-alerts uninstall  # Deregister + remove hook
npx wave-claude-visual-alerts doctor     # Check wsh, hook script, registration
npx wave-claude-visual-alerts test       # Cycle every state, 4s each
```

## Requirements

- [Wave Terminal](https://waveterm.dev) **v0.14.2+** (needs badge auto-clearing)
- [Claude Code](https://claude.ai/claude-code) v2.x
- Node.js 18+

No `jq`. No config file. No state directory.

## Customization

Every icon and colour is overridable by environment variable, read at hook time:

```bash
export WAVE_ALERT_COLOR_BUSY="#429DFF"      # blue instead of yellow
export WAVE_ALERT_ICON_BUSY="hourglass+spin"
```

Pattern is `WAVE_ALERT_COLOR_<STATE>` and `WAVE_ALERT_ICON_<STATE>`, where `<STATE>` is one of `BUSY`, `INPUT`, `WAITING`, `MCP`, `DONE`, `FAILED`, `SUBAGENT`.

### Icons

Wave bundles **Font Awesome Pro 6.7.2**, so any of its **4,205 icon names** works. Browse them at [fontawesome.com/icons](https://fontawesome.com/icons), or list the exact set your install ships:

```bash
cd "$(mktemp -d)" &&
npx --yes asar extract-file \
  /Applications/Wave.app/Contents/Resources/app.asar \
  dist/frontend/fontawesome/css/fontawesome.min.css &&
grep -oE '\.fa-[a-z0-9-]+\{' fontawesome.min.css |
  sed -E 's/^\.fa-//; s/\{$//' | sort -u
```

Useful ones for alerts:

| | |
|---|---|
| **Attention** | `flag` `bell` `bell-on` `circle-exclamation` `triangle-exclamation` `fire` `bolt` |
| **Waiting on you** | `hand` `circle-question` `message-question` `person-circle-question` `key` `lock` |
| **Done** | `circle-check` `check` `star` |
| **In progress** | `spinner` `hourglass` `hourglass-half` `clock` |
| **Misc** | `robot` `comment` `comment-dots` `envelope` `circle-dot` `circle-small` |

**Style prefixes.** Bare names resolve to solid; prefix for other families:

| Syntax | Renders as |
|---|---|
| `bell` or `solid@bell` | Solid (default) |
| `regular@bell` | Sharp Regular — lighter outline |
| `brands@github` | Brand logos |

**Animation suffixes.** Append `+beat` (pulses size), `+fade` (pulses opacity), or `+spin` (rotates). All three verified working as tab badges.

> **Gotcha:** an unrecognised icon name is accepted silently and renders as an
> **empty badge** — nothing validates it. If a badge vanishes after you change
> the icon, check the spelling.

### Colours

Any hex (`#RRGGBB`, `#RRGGBBAA`) or CSS colour name. The defaults come from Wave's own flag palette: green `#58C142`, teal `#00FFDB`, blue `#429DFF`, purple `#BF55EC`, red `#FF453A`, orange `#FF9500`, yellow `#FFE900`.

## How It Works

`setup` writes `~/.wave-alerts/hooks/wave-alert-hook.sh` and registers it in `~/.claude/settings.json` for eight events. The state arrives as an **argument**, not parsed from the stdin JSON, which is why the hook needs no `jq`:

```json
{ "Stop": [{ "hooks": [{ "type": "command",
    "command": "~/.wave-alerts/hooks/wave-alert-hook.sh done", "timeout": 3 }] }] }
```

The hook reads `WAVETERM_TABID` from the environment and exits silently if unset, so it is harmless outside Wave.

### Known limitations

- **One badge per tab**, so two Claude sessions sharing a tab share the alert slot and the most recent event wins. Their busy spinners are per-block and don't collide. One session per tab — the usual layout — is unaffected.
- **No duration threshold.** Claude Code has no "running longer than N minutes" event. `busy` covers the whole turn, however long.
- **No workflow or `/loop` events.** Workflows surface as `SubagentStart`/`SubagentStop` per agent; `/loop` iterations are ordinary turns.

## Coexistence

`setup` only adds and removes its own entries, matched by the `wave-alert-hook` filename, and backs up `settings.json` first. Other hooks are never touched.

## Troubleshooting

Run `npx wave-claude-visual-alerts doctor`.

**Nothing appears?** Confirm `echo $WAVETERM_TABID` is non-empty in the Claude Code pane. Hooks inherit the shell environment.

**Spinner stuck after a crash?** `pkill -f wave-alert-busy` clears any orphaned sentinel.

## License

MIT
