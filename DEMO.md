# wave-claude-visual-alerts — Demo Steps

Pause a few seconds between steps so the viewer can see the tab icon change.

## Prerequisites

- At least two Wave tabs open with Claude, and one without, so the difference
  shows.
- Permission mode set to **"ask every time"** (shift+tab to cycle).
- `npx wave-claude-visual-alerts setup` has been run.

---

## Step 1: Announce

> "Every tab with Claude in it shows one icon: what that session is doing
> right now. Teal pulse means live and idle, blue means working, yellow means
> it asked you something, orange means blocked on you, red means it failed.
> No icon, no Claude."

---

## Step 2: The whole scheme at once

Run:

```bash
npx wave-claude-visual-alerts test
```

Every state cycles for four seconds each.

---

## Step 3: Working, then idle

Ask Claude to do something slow, then **switch to another tab**. The spinner
keeps turning on the tab you left. When it finishes, it turns into the teal
pulse. Point at the tabs with no icon at all: no Claude session there.

---

## Step 4: A wait holds until it is answered

While Claude is working, trigger a permission prompt:

```bash
cat /etc/hosts | head -5
```

The spinner becomes an orange hand. Switch to the tab and look at it without
answering: the hand stays, because nothing is resolved yet. Approve it, and
the spinner returns.

---

## Step 5: Wrap up

> "One icon per tab, always the current state, never a stale one. Install
> with: npx wave-claude-visual-alerts setup"
