# Decision log

Why things are the way they are, especially where the obvious fix was tried
and rejected. Newest first.

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
