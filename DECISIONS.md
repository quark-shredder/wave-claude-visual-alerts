# Decision log

Why things are the way they are, especially where the obvious fix was tried
and rejected. Newest first.

---

## 2026-10-19 — Always-on session indicator; block badges pinned to Claude, not a sentinel

**Status:** shipped in 1.3.0.

### The ask

Tell tabs with an open Claude session apart from tabs with none, including
when the session is idle. Before this, an idle session's tab was blank once
you had looked at it.

### What Wave 0.14.5 actually does (read from its source and bundle)

- **One badge per object.** A tab shows its own badge plus one per block,
  sorted by priority: the top one as the 12 px icon, the next two as 4 px
  dots. A manual flag joins as priority 0.
- **A new badge only lands if it outranks the current one**, or ties and is
  newer (`cmpBadge(incoming, existing) > 0`, in both the backend store and the
  frontend). `--clear` always lands.
- **A pid exit clears by badge id**, polling once a second, and only if that
  badge is still current. This supersedes the 2026-08-19 note that Wave
  "clears badges by oref": in 0.14.5 a stale clear cannot wipe a newer badge.

### Design

The tab keeps the alerts. The block, which held only the spinner, now holds
the indicator whenever it does not hold the spinner. Both are pinned with
`--pid` to **Claude's own pid** (the hook's `$PPID`, measured), so:

- the badge goes when Claude exits, including on `kill -9`, with no
  `SessionEnd`. Measured: killed at 14:17:20, cleared at 14:17:20.731;
- the `sleep 86400` sentinel and its pid file are gone. A crashed session no
  longer leaves a spinner for a day.

Priorities: spinner 5, indicator −1. Just under the flag, so flagged tabs keep
the flag as the main icon. Going busy is one set; going idle needs a clear
first, because the indicator ranks below the spinner.

`SessionStart` is matched on `startup|resume|clear`, not `compact`: auto-
compaction can fire it mid-turn, and the indicator would replace the spinner
while Claude works.

`setup` backfills sessions already open, which fired `SessionStart` before
the hook existed. It finds each `claude` process, reads `WAVETERM_BLOCKID`
from its environment, skips any whose parent is also `claude`, and pins an
indicator to it without a clear, so a busy block keeps its spinner.
`pgrep -a` is needed: by default macOS `pgrep` drops its own ancestors,
which hid the session running `setup`.

### Verified, this machine, Wave 0.14.5, Claude Code 2.1.303

Real sessions through the installed hook, with made-up tab and block ids so
no visible tab changed, read back from `waveapp.log`: session start sets the
indicator; the prompt sets the spinner; the next `PreToolUse` sets nothing;
`Stop` clears, resets the indicator and turns the tab green; `SessionEnd`
clears both. Backfill: 9 sent, 8 accepted; the 9th was a busy block whose
spinner correctly outranked it.

### Accepted

- Wave starts one pid watcher per pinned badge, and they live until Claude
  exits: about two per turn. Each is a once-a-second liveness check.
- A crash leaves a few-byte `<blockid>.state` file. The next session in that
  block has a different parent pid, so it is ignored.

---

## 2026-09-29 — New states only where the case was shown to exist

**Status:** shipped in 1.2.0.

Each candidate was checked before any handling was built. "Live" means a
real Claude Code 2.1.283 session with every hook logged; "code" means read
from the 2.1.283 binary because the situation cannot be triggered on demand.

| Candidate | Evidence | Result |
|---|---|---|
| Turn ends on a question | Live: `Stop` carries `last_assistant_message` ("Which color do you prefer, red or blue?") | Built: `done` shows yellow when it ends in `?` |
| Esc during a tool call, via `PostToolUseFailure.is_interrupt` | Live: `PreToolUse`, Esc, then nothing — no `PostToolUseFailure`, no `Stop` | Not built. Esc is still silent |
| Usage limit reset / auto-continue off | Code: `quota_auto_resume_stale` "press enter to continue"; `_disabled` "will not resume on its own" | Built: `limit` |
| Auto-continue fired | Code: `quota_auto_resume_fired` "Claude is continuing your task" | Built: routed to `busy` |
| Claude driving mouse and keyboard | Code: `computer_use_enter` / `_exit` reach the Notification hook via `onOSNotification` | Built: `computer`, cleared on exit |
| Teammate needs permission | Code: lead session's inbox poller sends `worker_permission_prompt` and opens the dialog there | Built: routed to `input` |
| `AskUserQuestion` dialog | Live: fires `PermissionRequest` | Already shown as `input`; nothing built |
| `agent_completed`, `PreCompact`/`PostCompact`, `PermissionDenied` | Nothing for you to act on | Not built, same reasoning as `SubagentStop` |

### Why `Notification` is one registration

`setup` registers one entry per event and replaces any earlier wave entry for
that event, so several `Notification` entries with different arguments would
overwrite each other. Instead one entry lists every type, and the hook reads
`notification_type` from stdin. The hot `PreToolUse` path still reads no stdin.

### Accepted

- The question check is a heuristic: a message ending in `?`, after trailing
  newlines, spaces, `*`, `_` and backticks. A message that ends in a quoted
  question (`"ok?"`) stays green.
- `computer_use_exit` clears the tab badge, which would also clear any other
  alert set while Claude held the computer.
- The quota, computer-use and worker cases are verified from code only.

---

## 2026-09-28 — `idle_prompt` no longer shows yellow; it cannot clear the Esc spinner either

**Status:** `Notification` matcher narrowed from `idle_prompt|agent_needs_input`
to `agent_needs_input`.

### The problem

Finished tabs turned from green to yellow "waiting on you" although Claude had
asked nothing.

### Why it happened

In Claude Code 2.1.283, `idle_prompt` ("Claude is waiting for your input") is
sent once `messageIdleNotifThresholdMs` (default 60000) passes after a turn
completes with no keypress since. It fires after every finished turn,
question or not. Both badges sit on the tab, so the later yellow replaced the
green.

### Measured: one run each, interactive session driven by `expect`, hooks logged

```
normal turn:  23:28:18 Stop   23:29:18 Notification idle_prompt   (60 s later)
Esc mid-turn: 23:24:57 Esc    ... nothing for 96 s, no Stop, no Notification
```

### Consequences

- **The `idle_prompt` route in the 2026-08-19 entry is closed.** It does not
  fire after an interrupt, so it cannot clear the stale spinner. And after a
  normal turn the spinner is already gone, so it has nothing to do there.
- Yellow now means only `agent_needs_input`: a background agent, teammate or
  setup dialog is blocked on you.
- Untested lead for the Esc spinner: `PostToolUseFailure` carries
  `is_interrupt`. It could only cover an Esc during a tool call, not during
  text output as in the run above.

---

## 2026-09-03 — URL-to-Chrome-profile routing is a PATH shim, opt-in, and does not cover clicks

**Status:** shipped in 1.1.0 as `install-open-shim`.

### The problem

Claude Code publishes artifacts under the account it is logged in as. When
Chrome's last-used profile is a different account, `open <url>` from Claude
lands on a 404. Before this, the workaround was a rule telling Claude to pass
`--profile-directory` by hand on every open.

### Why not inside Wave

Wave 0.14.5 has no setting for an external browser or profile. Its own link
clicks go through Electron's `openExternal`, straight to the macOS default
browser. `open` from a shell never touches Wave at all. Making Wave own this
means forking it.

### Why a shim over a default-browser router

[Finicky](https://github.com/johnste/finicky) (v4) can do this at the
default-browser layer and covers clicks too; verified in its source that a
browser rule takes a `profile` and launches with `--profile-directory`. It was
not chosen because it is system-wide, static (the profile is hardcoded in
config, not derived from the Claude login), and a third app to install. The
shim is scoped to Wave shells via `WAVETERM_BLOCKID`, re-derives the profile
from `~/.claude.json` on every call, and is one file.

### Consequences accepted

- **Clicked links in Wave are not routed.** Documented in the README. Users who
  need that should use Finicky; the shim and Finicky coexist fine.
- **macOS only.** The command refuses on other platforms.
- **Resolver uses `node`, not `python3`.** The package already needs Node 18;
  on a Mac without Xcode CLT, `python3` can trigger an install prompt.
- **PATH is not edited automatically.** The installer prints the line. Editing
  rc files unasked is how tools become untrustworthy.

---

## 2026-08-19 — A spinner left by an interrupted turn is not cleared on the next prompt

**Status:** reverted, deliberately. Implemented in `b535f5f`, reverted in `9703e17`.

### The scenario

You give Claude a long task. Partway through you hit **Esc** to interrupt it.
The session stops, but the tab keeps showing the blue "working" spinner. It
stays that way until that session's next turn completes normally, or until the
sentinel's `sleep 86400` expires a day later.

### Why it happens

**Claude Code fires no hook event when a turn is interrupted.** This was
measured, not assumed. Every hook invocation was logged across two real Esc
interrupts, and the log contained only the `busy` events from the turns that
restarted afterwards:

```
18:21:09 busy tab=ffd87d3f     <- interrupted after this
18:21:17 busy tab=ffd87d3f     <- interrupted after this too
18:21:25 busy tab=ffd87d3f
```

No `Stop`. No `StopFailure`. Nothing. `Stop` only fires when Claude finishes
on its own. So nothing tells the hook the turn ended, the sentinel process
survives, and the badge pinned to it keeps rendering.

### What was tried

A `turnstart` state on `UserPromptSubmit` that killed the sentinel, on the
reasoning that a new prompt proves the previous turn ended. `busy` moved off
`UserPromptSubmit` entirely and fired only on `PreToolUse`.

It worked for the case it targeted, and was verified end to end.

### Why it was reverted

1. **It fixed the wrong end of the problem.** The complaint is that the tab
   lies *while you sit there deciding what to do next*. Killing the sentinel
   when you finally type is after the moment that matters. The reported
   symptom survived the fix.

2. **It made the spinner fragile on input.** Anything arriving on
   `UserPromptSubmit` would kill a live spinner. Typing a follow-up while
   Claude is still working is normal, and whether Claude Code fires that hook
   at queue time or at processing time was never established. If at queue
   time, typing ahead would blank the spinner mid-task until the next tool
   call. Trading a known-rare bug for a plausible everyday one is a bad deal.

3. **A better lever was never tested.** `Notification` with matcher
   `idle_prompt` fires when Claude has been idle. After an interrupt Claude
   *is* idle, so making the `waiting` state kill the sentinel would clear the
   spinner about a minute after Esc — without touching it on input at all, and
   semantically correct besides: if Claude is idle-prompting, it is by
   definition not working. Whether it actually fires after an interrupt is
   still unknown.

### Where this leaves us

The stale spinner after Esc is **known and unfixed**. It clears when that
session's next turn completes, or via `pkill -f wave-alert-busy-<tabid>`.

**Do not fix this by touching the spinner on `UserPromptSubmit`.** That is the
path already tried and rejected. Test the `idle_prompt` route first; it is the
only candidate that closes the idle window rather than its tail.

### Related constraints worth knowing before touching this

- **Never kill the sentinel and set a new badge in quick succession.** Wave
  clears badges by *oref*, not by badge id, and does so asynchronously when a
  watched pid exits. The stale clear can land after the new badge is set and
  wipe it, leaving a live sentinel with nothing displayed. This was a real bug,
  fixed in 1.0.1 by reusing a live sentinel instead of respawning one.
- **The spinner must stay pid-linked.** Pid-linked badges are the only ones
  Wave's auto-clear-on-focus skips. Dropping the pid link would make the
  spinner self-clear on interrupt, which sounds like a fix, but it would also
  clear every time you look at a tab that is genuinely working, then reappear
  on the next tool call. Constant flicker is worse than a rare stale badge.
- **`busy` must stay on `PreToolUse`.** A turn started with a `!` bash command
  never fires `UserPromptSubmit`, and would otherwise show no spinner at all.
