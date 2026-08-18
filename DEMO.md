# wave-claude-visual-alerts — Demo Steps

Pause a few seconds between steps so the viewer can see the tab badge change.

## Prerequisites

- At least two Wave tabs open, so badges can be seen on an inactive one.
- Permission mode set to **"ask every time"** (shift+tab to cycle).
- `npx wave-claude-visual-alerts setup` has been run.

---

## Step 1: Announce

> "This turns the Wave tab bar into a status board for Claude Code. Yellow
> means working, orange means blocked on you, green means done, red means it
> failed. Only the ones that need you animate."

---

## Step 2: The whole scheme at once

Run:

```bash
npx wave-claude-visual-alerts test
```

Every state cycles for four seconds each. Point out that the four animated
states are exactly the ones where Claude has stopped and is waiting.

---

## Step 3: Busy vs done, live

Ask Claude to do something slow, then **switch to another tab**. The spinner
keeps turning on the tab you left. When it finishes, it flips to a green check.

Switch back: the green check clears itself within a second. That is Wave, not
this tool — nothing here ever clears an alert.

---

## Step 4: The spinner survives focus

While Claude is still working, switch to its tab and stay there. The spinner
keeps spinning rather than clearing, because it is pinned to a sentinel
process. Every other badge would have cleared.

---

## Step 5: Alert over spinner

While Claude is working, trigger a permission prompt:

```bash
cat /etc/hosts | head -5
```

The orange hand takes the main icon slot and the yellow spinner demotes to a
small dot beside it. Approve it, and once the orange clears the spinner
returns to the main slot.

---

## Step 6: Wrap up

> "Two objects, eight states, no state files. Install with:
> npx wave-claude-visual-alerts setup"
