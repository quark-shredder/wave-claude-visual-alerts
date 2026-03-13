# wave-claude-visual-alerts

Color-coded visual alerts for [Claude Code](https://claude.ai/claude-code) running in [Wave Terminal](https://waveterm.dev). Never miss when Claude finishes a task or needs permission — block borders, tab indicators, and background tints light up with priority-based colors so you always know where to look, even across multiple tabs and windows.

## Quick Start

```bash
npx wave-claude-visual-alerts setup
```

Then restart Claude Code.

## What It Does

Three visual layers alert you when Claude needs attention:

| Layer | Scope | Visible when... |
|-------|-------|-----------------|
| **Block border** | Single block | Always (focused + unfocused) |
| **Tab badge** | Tab header dot | Persists on inactive tabs, auto-clears on active tab |
| **Tab background** | Subtle tint | Tab is active |

On the **active tab**, border color and background tint tell you what's happening. On **inactive tabs**, the colored badge dot draws your attention to switch there.

### Alert Colors

| Color | Hex | Trigger | Priority |
|-------|-----|---------|----------|
| Purple | `#AB47BC` | Task complete (`Stop`) | 1 |
| Cyan | `#00BCD4` | Permission needed | 4 |

Higher priority alerts take precedence. When the highest clears, it falls back to the next.

### Clear Triggers

- **You type a prompt** → all alerts clear
- **Tool runs after approval** → permission alert clears
- **Session ends** (`/exit`) → all alerts clear

## Commands

```bash
npx wave-claude-visual-alerts setup                    # Install with defaults
npx wave-claude-visual-alerts setup --theme nord       # Install with Nord theme
npx wave-claude-visual-alerts setup --no-bg            # Install without background tint
npx wave-claude-visual-alerts setup --bg-opacity 0.20  # Install with custom opacity

npx wave-claude-visual-alerts config                   # View current configuration
npx wave-claude-visual-alerts config --theme light     # Switch to Light theme
npx wave-claude-visual-alerts config --bg-opacity 0.15 # Change opacity
npx wave-claude-visual-alerts config --no-bg           # Disable background tint
npx wave-claude-visual-alerts config --bg              # Re-enable background tint

npx wave-claude-visual-alerts uninstall                # Remove hook + deregister
npx wave-claude-visual-alerts doctor                   # Check dependencies and configuration
```

## Requirements

- [Wave Terminal](https://waveterm.dev) (v0.14+)
- [Claude Code](https://claude.ai/claude-code)
- [jq](https://jqlang.github.io/jq/) — `brew install jq` (macOS) or `apt install jq` (Linux)
- Node.js 18+

## Themes

Three built-in color themes to match your Wave Terminal theme:

| Theme | Best for | Stop | Permission |
|-------|----------|------|------------|
| **vibrant** (default) | Dark themes (One Dark Pro, Dracula) | `#AB47BC` | `#00BCD4` |
| **nord** | Nord / Arctic themes | `#B48EAD` | `#88C0D0` |
| **light** | Light themes | `#7B1FA2` | `#D84315` |

Set a theme during setup or anytime after:

```bash
npx wave-claude-visual-alerts setup --theme nord
npx wave-claude-visual-alerts config --theme light
```

## Customization

Configuration is stored in `~/.wave-alerts/config.json`. Use CLI flags or edit directly:

```json
{
  "theme": "vibrant",
  "bgEnabled": true,
  "bgOpacity": 0.10,
  "colors": {
    "stop": "#AB47BC"
  }
}
```

All fields are optional — defaults are used for any missing values.

**Precedence:** `theme` sets base colors → `colors.*` overrides individual colors.

### Background tint

The subtle background tint can be configured:

- **Opacity:** `0.05`, `0.10` (default), `0.15`, `0.20`, `0.25`, `0.30`
- **Disable entirely:** `--no-bg` flag or `"bgEnabled": false`

Config changes take effect on the next hook trigger (no restart needed).

## How It Works

The package installs a bash hook script at `~/.wave-alerts/hooks/wave-alert-hook.sh` and registers it in Claude Code's `~/.claude/settings.json` for 7 hook events:

`PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `UserPromptSubmit`, `SessionStart`, `SessionEnd`

The hook uses Wave Terminal's `wsh` CLI to set block metadata (`frame:activebordercolor`, `frame:bordercolor`), tab indicators (`wsh tabindicator`), and tab backgrounds (`wsh setbg`).

State is tracked per-block in `/tmp/wave-alerts/{tabid}/{blockid}` for priority-based fallback across multiple Claude sessions.

## Coexistence

Works alongside other Claude Code hooks (like [peon-ping](https://github.com/PeonPing/peon-ping) and [vibecraft](https://github.com/anthropics/vibecraft)). The setup command only adds/removes its own entries and never touches other hooks.

## Troubleshooting

Run `npx wave-claude-visual-alerts doctor` to check your setup.

**Tab indicator not clearing?** State files may be stale. Run `rm -rf /tmp/wave-alerts/` to clean up.

**Colors not showing?** Make sure Wave Terminal is running and `wsh` is accessible.

**Wrong colors?** Check `~/.wave-alerts/config.json` for typos in hex values.

## License

MIT
