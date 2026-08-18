# wave-claude-visual-alerts — Demo Steps

Execute these steps one at a time. Pause a few seconds between each so the
viewer can see the tab flag change.

## Prerequisites

- At least two Wave tabs open, so the flag can be seen on an inactive one.
- Permission mode set to **"ask every time"** (shift+tab to cycle).
- Optional: right-click one tab → **Flag Tab** → pick a colour, to show that
  manual flags survive alerts.

---

## Step 1: Announce the demo

Print this message (no tool calls):

> "This is a demo of wave-claude-visual-alerts. It puts a coloured flag on the
> Wave tab when Claude needs you — orange when Claude wants permission, teal
> when the task is done. The flag clears itself when you focus the tab."

---

## Step 2: Show the done flag (teal)

Print this message (no tool calls):

> "First, the done flag. When Claude finishes responding, a teal flag appears
> on the tab — your turn."

Then stop. Make no tool calls, so the `Stop` hook fires.

**Switch to another tab** and point at the teal flag on this one.

---

## Step 3: Show that focusing clears it

Switch back to the Claude tab. The flag disappears about half a second later —
no hook involved, Wave clears it on focus.

---

## Step 4: Show the permission flag (orange)

Print this message:

> "Now the permission flag. When Claude needs approval to run a command, the
> flag turns orange."

Then immediately run:

```bash
cat /etc/hosts | head -5
```

Switch to another tab while the prompt is pending. The orange flag marks the
tab that is blocked on you. Come back and approve it.

---

## Step 5: Show coexistence with a manual flag

If you flagged this tab by hand in the prerequisites, point out that during an
alert the alert flag takes the main icon slot and your colour shrinks to a
small dot beside it — then returns to the main slot once the alert clears.
Nothing overwrites your `tab:flagcolor`.

---

## Step 6: Wrap up

Print:

> "One flag. Clears itself. Install with: npx wave-claude-visual-alerts setup"

Then stop.
