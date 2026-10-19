# wave-claude-visual-alerts

Turns the [Wave Terminal](https://waveterm.dev) tab bar into a live status board for [Claude Code](https://claude.ai/claude-code). At a glance you can see which tabs have a Claude session at all, which are working, which are finished, and which are blocked waiting on you.

Built for the case where you have eight or more Wave tabs open and need to know *which one* wants you.

## Quick Start

```bash
npx wave-claude-visual-alerts setup
npx wave-claude-visual-alerts test   # cycle every state so you can see them
```

No restart needed — Claude Code hot-reloads `settings.json`.

## The Scheme

**Colour carries urgency. Animation carries kind.**

**Cool colours need nothing from you. Warm colours escalate.**

| | Colour | State | Needs you? |
|---|---|---|---|
| ⚪ | Grey `#8E8E93` | session open, idle | no |
| 🔵 | Blue `#429DFF` | working | no |
| 🟢 | Green `#58C142` | finished | no |
| 🩵 | Teal `#00FFDB` | using your mouse and keyboard | no — hands off |
| 🟡 | Yellow `#FFE900` | asked you something, or paused on a usage limit | soon |
| 🟠 | Orange `#FF9500` | blocked on you | now |
| 🔴 | Red `#FF453A` | failed | now |
| 🟣 | Purple `#BF55EC` | MCP wants input | now (external) |

Temperature encodes urgency, so you can rank three states without remembering what any colour "means": yellow → orange → red is *waiting* → *blocked* → *broken*. Purple sits outside the ladder because an MCP elicitation is a different category — an external system, not Claude.

Animation carries kind rather than urgency:

| Animation | Meaning |
|---|---|
| `+spin` | An ongoing process |
| `+beat` | Needs you now |
| `+fade` | Waiting, passive |
| *(static)* | Happened, no rush |

A working tab should never compete for attention with a blocked one. Only the states where Claude has stopped and is waiting animate.

## States

| State | Claude Code event | Icon | Colour | Meaning |
|---|---|---|---|---|
| `session` | `SessionStart` (startup, resume, clear), and after every `Stop` / `StopFailure` | `asterisk` | ⚪ `#8E8E93` | A Claude session is open in this tab. Always on until Claude exits |
| `busy` | `UserPromptSubmit`, `PreToolUse` | `spinner+spin` | 🔵 `#429DFF` | Claude is working |
| `input` | `PermissionRequest` | `hand+beat` | 🟠 `#FF9500` | Needs a permission decision |
| `waiting` | `Stop`, `Notification` | `circle-question+fade` | 🟡 `#FFE900` | Claude's last message ends in a question, or a background agent needs your input |
| `limit` | `Notification` | `hourglass-end+fade` | 🟡 `#FFE900` | Usage limit reset or auto-continue stopped; press Enter to continue |
| `mcp` | `Elicitation` | `message-question+beat` | 🟣 `#BF55EC` | An MCP server wants input |
| `computer` | `Notification` | `computer-mouse` | 🩵 `#00FFDB` | Claude is using your mouse and keyboard; cleared when it hands them back |
| `done` | `Stop` | `circle-check` | 🟢 `#58C142` | Turn finished |
| `failed` | `StopFailure` | `triangle-exclamation+beat` | 🔴 `#FF453A` | Turn died on an API error |
| `end` | `SessionEnd` | — | — | Session over; clears everything |

`Stop` shows yellow instead of green when Claude's last message ends in `?`. Claude Code passes that message to the hook as `last_assistant_message`, and the hook reads it with `sed`, not `jq`.

`Notification` is registered once, for these types only, and the hook routes each by its `notification_type`:

| Type | State |
|---|---|
| `agent_needs_input` | `waiting` |
| `worker_permission_prompt` (a teammate needs permission) | `input` |
| `quota_auto_resume_stale`, `quota_auto_resume_disabled` | `limit` |
| `quota_auto_resume_fired` (Claude resumes by itself) | `busy` |
| `computer_use_enter` / `computer_use_exit` | `computer` on / cleared |

`idle_prompt` is deliberately left out: it fires 60 seconds after *every* finished turn you haven't answered, so it turned each unvisited green tab yellow. `AskUserQuestion` needs nothing extra: it fires `PermissionRequest`, so it already shows `input`. See the [decision log](DECISIONS.md).

**`SubagentStop` is deliberately not used.** A subagent finishing means the main turn is still running, which `busy` already covers. Worse, its badge would outrank the spinner and leave an inactive tab showing "a subagent finished" while it is actually still working.

## Why Two Objects

Wave allows **one badge per object**, so a naive implementation has every state overwrite the last. This uses two objects deliberately:

- **Alerts go on the tab.** Wave ≥ 0.14.2 ships a `BadgeAutoClearing` component that removes a tab badge ~500 ms after you focus that tab (3 s if you were already there). So there are no clear-hooks, no state directory, and no way for a stale alert to stick.
- **The block holds one always-on badge while Claude runs**: the grey session indicator when idle, the blue spinner while working. Both are pinned to Claude's own pid via `wsh badge --pid`. Pid-linked badges are skipped by auto-clear, so they survive you looking at the tab, and Wave removes them itself within a second of Claude exiting, even on a crash.

Wave only lets a new badge replace one of lower priority, or of equal priority and older. The spinner (5) outranks the indicator (−1), so going busy is a single set; going idle is a clear, then a set. A pid exit clears by badge id, so it can never wipe a newer badge.

`busy` fires on **both** `UserPromptSubmit` and `PreToolUse`. The second is necessary because a turn started with a `!` bash command never fires `UserPromptSubmit`, and would otherwise run with no spinner at all. Since `PreToolUse` fires on every tool call, the already-spinning path must be cheap: `~/.wave-alerts/run/<blockid>.state` records `busy:<claude pid>`, so the check is one file read against the hook's parent pid, about 4 ms including bash startup.

Badges sort by priority, highest first: failures 15, alerts 10, spinner 5, a manual flag 0, session indicator −1. The top one takes the 12 px icon slot and the next two show as 4 px dots. So an alert shows with the spinner or indicator as a dot beside it, and the block badge returns to the main slot when the alert clears.

**How each state sits with the indicator:**

| While… | Main icon | Dot beside it |
|---|---|---|
| idle, nothing pending | ⚪ session | — |
| working | 🔵 spinner | — |
| working and blocked (permission, `AskUserQuestion`, MCP, teammate) | 🟠 / 🟣 alert | 🔵 spinner |
| turn just ended, not yet looked at | 🟢 done / 🟡 question / 🔴 failed | ⚪ session |
| paused on a usage limit | 🟡 hourglass | ⚪ session |
| after you focus the tab | ⚪ session | — |
| Claude exited, or no Claude in this tab | nothing | — |

Sessions that were already open when you run `setup` get the indicator straight away: `setup` finds each running `claude` in a Wave block and pins one to it. A session that is mid-turn keeps its spinner, since the spinner outranks it.

## Plays Nicely With Manually Flagged Tabs

If you use Wave's **Flag Tab** right-click menu to colour-code tabs, this never disturbs it — it does not write `tab:flagcolor`. Wave merges your manual flag as a synthetic `priority: 0` badge, so alerts and the spinner outrank it, and it returns to the main slot once they clear. The session indicator sits just *below* the flag (−1), so a flagged tab keeps its flag as the main icon and shows the session as a grey dot beside it.

## Commands

```bash
npx wave-claude-visual-alerts setup      # Install hook + register in settings.json
npx wave-claude-visual-alerts uninstall  # Deregister + remove hook
npx wave-claude-visual-alerts doctor     # Check wsh, hook script, registration
npx wave-claude-visual-alerts test       # Cycle every state, 4s each
npx wave-claude-visual-alerts install-open-shim   # Optional, macOS — see below
```

## Requirements

- [Wave Terminal](https://waveterm.dev) **v0.14.2+** (needs badge auto-clearing)
- [Claude Code](https://claude.ai/claude-code) v2.x
- Node.js 18+

No `jq`. No config file.

## Customization

Every icon and colour is overridable by environment variable, read at hook time:

```bash
export WAVE_ALERT_COLOR_BUSY="#8E8E93"      # grey instead of blue
export WAVE_ALERT_ICON_BUSY="hourglass+spin"
```

Pattern is `WAVE_ALERT_COLOR_<STATE>` and `WAVE_ALERT_ICON_<STATE>`, where `<STATE>` is one of `SESSION`, `BUSY`, `INPUT`, `WAITING`, `LIMIT`, `MCP`, `COMPUTER`, `DONE`, `FAILED`.

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

## Optional: `open` URLs in the right Chrome profile (macOS)

If Claude Code is logged into one account and Chrome opens with another, every `open <url>` Claude runs lands on the wrong profile, and account-scoped pages (artifacts, Jira, Confluence) 404. This is separate from the alerts and off by default:

```bash
npx wave-claude-visual-alerts install-open-shim
# then add to ~/.zshrc:  export PATH="$HOME/.wave-alerts/bin:$PATH"
```

It installs `~/.wave-alerts/bin/open`, a 30-line shell script shadowing `/usr/bin/open`. Inside a Wave shell, a call with only http(s) URLs is routed to the Chrome profile whose account matches `oauthAccount.emailAddress` in `~/.claude.json`, resolved through Chrome's `Local State` at call time, so switching Claude login switches profile with nothing to reconfigure. Anything else — file paths, `-a`, no arguments, any shell without `WAVETERM_BLOCKID` — passes straight through. It is not a daemon; it runs only for the duration of an `open` call.

**Not covered:** links you *click* in Wave. Electron hands those to the macOS default browser directly, and Wave has no setting for a target browser. If you need clicks routed too, a URL router such as [Finicky](https://github.com/johnste/finicky) as the default browser is the right layer; see [DECISIONS.md](DECISIONS.md).

`uninstall-open-shim` removes it; plain `uninstall` removes it along with everything else.

## How It Works

`setup` writes `~/.wave-alerts/hooks/wave-alert-hook.sh` and registers it in `~/.claude/settings.json` for nine events. The state arrives as an **argument**, not parsed from the stdin JSON, which is why the hook needs no `jq`:

```json
{ "Stop": [{ "hooks": [{ "type": "command",
    "command": "~/.wave-alerts/hooks/wave-alert-hook.sh done", "timeout": 3 }] }] }
```

The hook reads `WAVETERM_TABID` from the environment and exits silently if unset, so it is harmless outside Wave.

### Known limitations

- **One badge per tab**, so two Claude sessions sharing a tab share the alert slot and the most recent event wins. Their busy spinners are per-block and don't collide. One session per tab — the usual layout — is unaffected.
- **No duration threshold.** Claude Code has no "running longer than N minutes" event. `busy` covers the whole turn, however long.
- **Interrupting a turn with Esc leaves the spinner running.** Claude Code fires no hook event on interrupt, so nothing tells the hook the turn ended. It turns back into the session indicator when that session's next turn completes, and goes when Claude exits. The obvious fix — clearing it on the next prompt — was tried and reverted; see [DECISIONS.md](DECISIONS.md) before attempting it again.
- **One indicator per block.** Two Claude sessions in one tab, in separate blocks, each get their own; the tab shows the highest-priority one.
- **No workflow or `/loop` events.** Workflows surface as `SubagentStart`/`SubagentStop` per agent; `/loop` iterations are ordinary turns.

## Coexistence

`setup` only adds and removes its own entries, matched by the `wave-alert-hook` filename, and backs up `settings.json` first. Other hooks are never touched.

## Troubleshooting

Run `npx wave-claude-visual-alerts doctor`.

**Nothing appears?** Confirm `echo $WAVETERM_TABID` is non-empty in the Claude Code pane. Hooks inherit the shell environment.

**Indicator or spinner left after a crash?** It shouldn't be: both are pinned to Claude's pid, and Wave removes them within a second of the process exiting. Wave logs it as `BadgeWatchPidCommand: pid … gone` in `~/Library/Application Support/waveterm/waveapp.log`.

**Session indicator missing on an open session?** Run `setup` again; it backfills every running session it can find in a Wave block.

## License

MIT
