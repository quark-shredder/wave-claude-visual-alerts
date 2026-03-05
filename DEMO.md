# wave-claude-visual-alerts — Demo Steps

Execute these steps one at a time. Pause 3 seconds between each step so the viewer can see the indicator changes.

## Prerequisites

- Permission mode must be set to **"ask every time"** (shift+tab to cycle)
- Run `rm -rf /tmp/wave-alerts` to clear stale state

---

## Step 1: Announce the demo

Print this message (no tool calls):

> "This is a demo of wave-claude-visual-alerts — color-coded borders and tab indicators for Claude Code in Wave Terminal. There are two alerts: purple when Claude finishes, and cyan when Claude needs permission."

---

## Step 2: Show the Stop indicator (purple)

Print this message (no tool calls):

> "First, the Stop indicator. When Claude finishes responding, the block border, tab indicator, and background all turn purple — signaling it's your turn."

Then stop. Do NOT make any tool calls. Just end your response here so the Stop hook fires and the purple indicator appears.

---

## Step 3: Show the Permission indicator (cyan)

Print this message:

> "Now the Permission indicator. When Claude needs your approval to run a command, everything turns cyan."

Then immediately run this bash command:

```bash
cat /etc/hosts | head -5
```

This will trigger a permission prompt. The cyan indicator should appear on the block border, tab, and background. Wait for the user to approve it.

---

## Step 4: Show permission clearing

After the command runs and output is shown, print:

> "Once you approve, the indicator clears instantly."

Then stop. The Stop hook will fire and show purple again.

---

## Step 5: Show multi-tab awareness

Print:

> "Tab indicators work across tabs. Even if you switch away, you can see which session needs attention from the tab bar."

Then stop.

---

## Step 6: Show the denial case

Print:

> "If you deny a permission, the cyan indicator stays visible until you respond — so you don't lose track."

Then run this bash command:

```bash
echo "This command should be DENIED by the user"
```

The user will deny this. After denial, print:

> "The indicator persists after denial. It clears when you type your next message."

Then stop.

---

## Step 7: Wrap up

Print:

> "Two colors. Zero noise. Install with: npx wave-claude-visual-alerts setup"

Then stop.
