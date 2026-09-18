# Uptime

A streak you keep by existing.

Uptime takes the "I started a stopwatch and never stopped it" trend and gives
it stakes: the time you keep becomes a currency you can bank, give away, and
spend bringing a friend's broken streak back.

The clock is never a running process. Every number in the app is
`now - streak_start`, computed at the moment it is read — the same trick that
lets a phone's stopwatch survive a restart.

---

## Running it

```bash
npm install
npm run dev          # browser, http://localhost:1420
npm run desktop:dev  # the same app in a Tauri window
npm test             # 56 tests over the domain rules and the store
```

With no Supabase project configured the app runs against browser storage with
a seeded cast of friends in deliberately varied states — one long-running, one
inside the nudge window, two lapsed and revivable. A `LOCAL` badge in the
header tells you which adapter is live.

This is not a mock. The local adapter runs the same `src/core` rules the server
does, so the gift caps, the lapse sweep and the revive price all behave
identically before any backend exists.

To point at a real project, copy `.env.example` to `.env` and fill it in;
`src/data/index.ts` switches adapters on those variables alone.

---

## How it fits together

```
src/core/         Pure rules. No I/O, no React. Every number the app shows is
                  derived here from two timestamps and a ledger.
src/data/         One store interface, two adapters (local, Supabase).
src/components/   
src/screens/      
supabase/         Schema, rules, and the two scheduled jobs.
src-tauri/        The native shell: Windows, Android, iOS from one codebase.
```

The seam that matters is `src/data/store.ts`. Screens receive a `Snapshot` of
answers and never compute a balance themselves, because the same derivation has
to hold across both adapters — and because a client that can compute its own
balance is a client that can lie about it.

### The stop problem

A server clock never dies on its own, so nothing would ever naturally stop. The
mechanic that restores real risk of failure is a **60-day check-in window**: any
sign of life — opening the app, tapping a push, sending or receiving a gift —
moves `last_seen`. If `last_seen` falls further behind than the window, the
streak lapses.

Two details that are easy to get wrong and are tested for:

- A lapse is dated to **the deadline**, not to whenever the sweeper noticed. A
  sweep running a week late does not hand out free days.
- A lapsed run is credited **up to `last_seen`**, not through the grace window.
  Vanishing should not earn the same as showing up.

Deliberately not daily. Snapchat's 24-hour cycle produces the documented
pathologies — proxy snapping, paid restoration, streaks their owners describe
as anxiety-inducing. A 60-day window is invisible to an active user and only
ever fires on someone who has genuinely gone.

**One consequence worth knowing about.** Because opening the app is itself a
sign of life, the window bar as originally specified could only ever read
full — the act of looking at it refills it. So the bar is measured from
`windowAnchor`: where the window stood *before this visit*. It now says
something true ("you last showed up 58 days ago, 2 days left") and the offer to
turn on reminders fires at the one moment a user has a reason to accept it.
An explicit check-in is what refills it.

For the same reason the `lapsed` *status* is nearly unobservable — every open
sweeps it — so the reset message is driven by the last closed run instead.
Without that, a returning user would find a zeroed counter and no explanation.

### The economy

Banked time accrues at **10% of all time kept** and is separate from the streak,
so giving time away never makes your own record look shorter than it ran.

Reviving a broken streak restores **half** its lost length and costs the reviver
that restored stretch's own accrual — 10% of it. A 400-day streak comes back at
200 days and costs 20 banked days, which is more than most single users hold.
That is intentional: a headline rescue takes more than one friend.

Balances are sums over a ledger, never a column. That makes the donation and
reception boards a `GROUP BY` and gives a free audit trail.

---

## Status

| Milestone | State |
|---|---|
| 1. Accounts and the bare timer | Done. Timer, pulse hero, derived elapsed. |
| 2. Cross-platform shell | Desktop done and building. Android/iOS configured, not built here — see below. |
| 3. The heartbeat | Done. Window, per-user and batch sweep, reset flow. |
| 4. Push notifications | Code complete, unverified — needs credentials. |
| 5. The time economy | Done. Ledger, sending, revive, follow/unfollow. |
| 6. Leaderboards | Done. All six boards. |
| 7. Abuse hardening | Done: friend gate, rolling cap, account-age gate, RLS. |

### What was verified, and how

- **62 automated tests** over the domain rules and the store, including lapse
  timing, cap enforcement, revive pricing, the one-way-follow gate, window
  anchoring and reload-from-storage.
- **The SQL was applied to a real PostgreSQL 17** and exercised end to end:
  derivation, the mutual-follow gate (a one-way follow is still refused), the
  rolling cap, overdrafts, revive pricing, double-revive prevention, and the
  leaderboards. The RLS was tested under Supabase's default grant posture, and
  the write-guard trigger was tested with a grant deliberately restored.
- **Every screen was rendered in a headless browser** at phone width with no
  console errors, including the states that are awkward to reach by hand:
  a window about to close, a streak just swept, and a one-way follow.
- **A release desktop build**, producing a working `.exe` plus MSI and NSIS
  installers under `src-tauri/target/release/bundle/`.

### What was not verified, and why

- **Android and iOS builds.** No Android SDK or NDK is installed here and the
  JDK is 8 (Android needs 17+); iOS needs macOS. The Tauri project is
  configured for both and `npm run android:init` / `ios:init` are wired, but
  neither has been run. Expect the usual first-run friction.
- **Push delivery.** `supabase/functions/nudge-check-in` implements FCM, APNs
  and WNS including the JWT signing each requires, but none of it has been run
  against a real provider — there are no credentials here. Budget real time for
  this; it is the one piece with no precedent in Nexo or Rater. The function
  skips any provider whose secrets are unset, so deploying it before you have
  credentials is harmless.
- **Supabase itself.** The migrations were validated against stock PostgreSQL
  with a small `auth` schema shim, not against a live Supabase project. The
  `auth.uid()` and `auth.users` integration points are the parts to watch.

---

## Deploying the backend

```bash
supabase link --project-ref <ref>
supabase db push
supabase functions deploy sweep-lapsed
supabase functions deploy nudge-check-in
```

Then schedule both — see the header comment in each function for the
`cron.schedule` call. `sweep-lapsed` is idempotent, so running it hourly costs
nothing.

Note that every action already sweeps the specific rows it touches, so the
scheduled job is a backstop for accounts nobody is interacting with rather than
the only thing standing between a dead streak and the leaderboards.

---

## Three things to decide

- **Following is the entry to everything social.** Gifts are gated on a mutual
  follow, so a fresh account can do nothing until it follows someone and is
  followed back. There is a handle field on the People tab and that is the
  whole discovery story — no search, no suggestions, no invite links. That is
  probably the next thing worth designing.
- **The name.** `Uptime` is the working name and is used throughout, including
  the bundle identifier `com.yungdice.uptime`. It has not had the gut check
  against the Yung Dice brand that the build prompt asked for.
- **`ACCRUAL_RATE`, `CHECK_IN_WINDOW` and the revive price** are the three
  numbers that decide how the game feels, and they are guesses. They are named
  constants in `src/core/constants.ts` with matching SQL functions in
  `0001_schema.sql`; changing them is a one-line edit in each.
