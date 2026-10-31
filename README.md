# wave-claude-visual-alerts

Turns the [Wave Terminal](https://waveterm.dev) tab bar into a live status board for [Claude Code](https://claude.ai/claude-code). Every tab with a Claude session shows exactly one icon: what that session is doing right now. Tabs with no session show nothing.

Built for the case where you have eight or more Wave tabs open and need to know *which one* wants you.

## Quick Start

```bash
npx wave-claude-visual-alerts setup
npx wave-claude-visual-alerts test   # cycle every state so you can see them
```

No restart needed — Claude Code hot-reloads `settings.json`.

## The Scheme

**One icon per tab, always the current state. Colour carries urgency; icon and animation carry kind.**

**Cool colours need nothing from you. Warm colours escalate.** Six colours, all from Wave's own flag palette, each with exactly one urgency:

| | Colour | Means | Needs you? |
|---|---|---|---|
| 🩵 | Teal `#00FFDB` | Claude is live here, not used yet | no |
| 🔵 | Blue `#429DFF` | working (spinner), or driving your mouse and keyboard | no |
| 🟢 | Green `#58C142` | finished | no |
| 🟡 | Yellow `#FFE900` | asked you something, or paused on a usage limit | soon |
| 🟠 | Orange `#FF9500` | blocked on you: permission, a question dialog, MCP input, a teammate | now |
| 🔴 | Red `#FF453A` | failed | now |

No icon means no Claude session in that tab.

Temperature encodes urgency: teal → blue → green is *live* → *working* → *done*, and yellow → orange → red is *waiting* → *blocked* → *broken*. *What* is asking is the icon's job: a hand for a permission, a speech bubble for MCP.

**A state holds until the next one replaces it**, not until you look. An unanswered permission stays orange after you glance at the tab; a question stays yellow until you reply.

Animation carries kind rather than urgency:

| Animation | Meaning |
|---|---|
| `+spin` | An ongoing process |
| `+beat` | Needs you now |
| `+fade` | Waiting, passive (including the idle teal pulse) |
| *(static)* | Happened, no rush |

## States

| State | Set by | Icon | Colour | Held until |
|---|---|---|---|---|
| `session` | `SessionStart` (startup, resume, clear) | `wave-pulse+fade` | 🩵 `#00FFDB` | the first prompt |
| `busy` | `UserPromptSubmit`, `PreToolUse`, and whatever resolves a wait (below) | `spinner+spin` | 🔵 `#429DFF` | the turn ends or needs you |
| `input` | `PermissionRequest` (also `AskUserQuestion`) | `hand+beat` | 🟠 `#FF9500` | answered: `PostToolUse` / `PostToolUseFailure` |
| `mcp` | `Elicitation` | `message-question+beat` | 🟠 `#FF9500` | answered: `ElicitationResult` |
| `waiting` | `Stop` when Claude's last message ends in `?`; a background agent needs input | `circle-question+fade` | 🟡 `#FFE900` | you reply |
| `limit` | usage limit reset, or auto-continue stopped | `hourglass-end+fade` | 🟡 `#FFE900` | Claude resumes, or you press Enter |
| `computer` | Claude takes your mouse and keyboard | `computer-mouse` | 🔵 `#429DFF` | it hands them back |
| `done` | `Stop` | `circle-check` | 🟢 `#58C142` | the next prompt |
| `failed` | `StopFailure` | `triangle-exclamation+beat` | 🔴 `#FF453A` | the next prompt |
| `end` | `SessionEnd` | — | — | clears everything |

The question check reads `last_assistant_message`, which Claude Code passes to the `Stop` hook, with `sed`, not `jq`.

`Notification` is registered once, for these types only, and the hook routes each by its `notification_type`:

| Type | State |
|---|---|
| `agent_needs_input` | `waiting` |
| `worker_permission_prompt` (a teammate needs permission) | `input` |
| `quota_auto_resume_stale`, `quota_auto_resume_disabled` | `limit` |
| `quota_auto_resume_fired` (Claude resumes by itself) | `busy` |
| `computer_use_enter` / `computer_use_exit` | `computer` / back to `busy` |

`idle_prompt` is deliberately left out: it fires 60 seconds after *every* finished turn. See the [decision log](DECISIONS.md).

**`SubagentStop` is deliberately not used.** A subagent finishing means the main turn is still running, which `busy` already covers.

## Why One Badge

Wave draws a tab's highest-priority badge as its 12 px icon and the next two as 4 px dots beside it, and has no setting to hide the dots. So any second badge on a tab shows up as a dot. Here, each Claude session owns exactly one badge, on its **block**, and every state replaces it.

That badge is pinned to Claude's own pid with `wsh badge --pid`. Pinned badges are skipped by Wave's clear-on-focus, which is what lets a state hold until it is resolved, and Wave removes the badge by itself within a second of Claude exiting, even on a crash.

Wave only lets a new badge replace one of lower priority, or of equal priority and older. Every active state is priority 5, so the newest simply wins. The two idle states, the teal pulse and the green check, are −1, so going idle is a clear, then a set. A pid exit clears by badge id, so it can never wipe a newer badge.

`busy` fires on `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure` and `ElicitationResult`. `PreToolUse` is needed because a turn started with a `!` bash command never fires `UserPromptSubmit`; the others end a wait. They fire on every tool call, so the already-spinning path must be cheap: `~/.wave-alerts/run/<blockid>.state` records the state and Claude's pid, so the check is one file read, about 4 ms including bash startup.

Sessions that were already open when you run `setup` get the idle pulse straight away: `setup` finds each running `claude` in a Wave block and pins one to it. A session that is mid-turn keeps its spinner, since the spinner outranks it.

## Plays Nicely With Manually Flagged Tabs

If you use Wave's **Flag Tab** right-click menu to colour-code tabs, this never disturbs it — it does not write `tab:flagcolor`. Wave merges your manual flag as a synthetic `priority: 0` badge. Active states outrank it; the teal pulse and green check sit just below it, so an idle flagged tab keeps its flag as the icon. A flagged tab is the one case with two badges, so it does show a dot: the flag's or the session's.

## Commands

```bash
npx wave-claude-visual-alerts setup      # Install hook + register in settings.json
npx wave-claude-visual-alerts uninstall  # Deregister + remove hook
npx wave-claude-visual-alerts doctor     # Check wsh, hook script, registration
npx wave-claude-visual-alerts test       # Cycle every state, 4s each
npx wave-claude-visual-alerts install-open-shim   # Optional, macOS — see below
```

## Requirements

- [Wave Terminal](https://waveterm.dev) **v0.14.2+** (needs pid-linked badges)
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

**Animation suffixes.** Append `+beat` (pulses size), `+fade` (pulses opacity), or `+spin` (rotates). Wave accepts only these three; other Font Awesome animations are dropped.

> **Gotcha:** an unrecognised icon name is accepted silently and renders as an
> **empty badge** — nothing validates it. If a badge vanishes after you change
> the icon, check the spelling.

### Colours

Any hex (`#RRGGBB`, `#RRGGBBAA`) or CSS colour name. The defaults come from Wave's own flag palette: teal `#00FFDB`, blue `#429DFF`, green `#58C142`, yellow `#FFE900`, orange `#FF9500`, red `#FF453A`. Its seventh, purple `#BF55EC`, is left free for your own flags.

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

`setup` writes `~/.wave-alerts/hooks/wave-alert-hook.sh` and registers it in `~/.claude/settings.json` for twelve events. The state arrives as an **argument**, not parsed from the stdin JSON, which is why the hook needs no `jq`:

```json
{ "Stop": [{ "hooks": [{ "type": "command",
    "command": "~/.wave-alerts/hooks/wave-alert-hook.sh done", "timeout": 3 }] }] }
```

The hook reads `WAVETERM_TABID` and `WAVETERM_BLOCKID` from the environment and exits silently if either is unset, so it is harmless outside Wave.

### Known limitations

- **No duration threshold.** Claude Code has no "running longer than N minutes" event. `busy` covers the whole turn, however long.
- **Interrupting a turn with Esc leaves the spinner running.** Claude Code fires no hook event on interrupt, so nothing tells the hook the turn ended. It turns into the green check when that session's next turn completes, and goes when Claude exits. The obvious fix — clearing it on the next prompt — was tried and reverted; see [DECISIONS.md](DECISIONS.md) before attempting it again.
- **The green check means "finished", not "finished and unseen".** It stays after you look, until your next prompt. Clearing it on focus would need a second, unpinned badge, which Wave draws as a dot.
- **Two Claude sessions in one tab**, in separate blocks, each keep their own badge; the tab shows the higher-priority one as the icon and the other as a dot.
- **Denying a permission is untested.** If Claude Code fires no hook on the denial, the orange hand stays until Claude's next step or your next prompt.
- **No workflow or `/loop` events.** Workflows surface as `SubagentStart`/`SubagentStop` per agent; `/loop` iterations are ordinary turns.

## Coexistence

`setup` only adds and removes its own entries, matched by the `wave-alert-hook` filename, and backs up `settings.json` first. Other hooks are never touched.

## Troubleshooting

Run `npx wave-claude-visual-alerts doctor`.

**Nothing appears?** Confirm `echo $WAVETERM_TABID` is non-empty in the Claude Code pane. Hooks inherit the shell environment.

**Icon left after a crash?** It shouldn't be: it is pinned to Claude's pid, and Wave removes them within a second of the process exiting. Wave logs it as `BadgeWatchPidCommand: pid … gone` in `~/Library/Application Support/waveterm/waveapp.log`.

**No icon on an open session?** Run `setup` again; it backfills every running session it can find in a Wave block.

## License

MIT
