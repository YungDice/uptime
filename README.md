# Uptime

A streak you keep by existing.

Uptime takes the "I started a stopwatch and never stopped it" trend and gives
it stakes: the time on your clock is a currency. Send some to a friend and it
comes straight off your timer and lands on theirs; spend some to bring a
friend's broken streak back.

The clock is never a running process. Every number in the app is
`now - streak_start`, computed at the moment it is read — the same trick that
lets a phone's stopwatch survive a restart.

---

## Running it

```bash
npm install
npm run dev          # browser, http://localhost:1420
npm run desktop:dev  # the same app in a Tauri window
npm test             # 100 tests over the domain rules and the store
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

**The time you send is your clock.** There is no separate bank. Sending an
hour takes that hour straight off your own running timer and adds it to the
recipient's; time sent to you is added to yours. Because nothing ticks, a
clock is `now - streak_start`, so a transfer moves two timestamps: the
sender's start later, the recipient's earlier. Both happen in one transaction,
with both rows locked in id order so two people sending to each other at the
same moment cannot deadlock.

The rules around it are unchanged: time only moves between mutual follows,
anonymous accounts cannot send, and at most 7 days can leave one account per
rolling 24 hours. Two follow from the new model: you can send at most what your
clock reads, and the recipient's clock has to be running - a stopped one has
nowhere for the time to land, and a lapsed one is what reviving is for.

Reviving a broken streak restores **half** its lost length and costs the
reviver a tenth of that restored stretch, **paid off their own clock**. A
400-day streak comes back at 200 days and costs its rescuer 20 days of their
own run. That is intentional: a headline rescue takes more than one friend.

The gift ledger is still the audit trail and what the given/received/rescues
boards count. Reads no longer sum it: each profile carries running totals,
kept in step with the ledger by a trigger in the same transaction.

An open app polls a one-row `uptime_pulse` every 30 seconds, so time a friend
sends you appears on your clock within half a minute - the full snapshot is
only re-read when the pulse says something moved.

### Scale

Every read now costs what it returns rather than what the table holds.
Measured on PostgreSQL 16 with 300,000 accounts (`0013_clock_transfers_and_scale.sql`):

| Read | Before | After |
|---|---|---|
| A leaderboard (each of six) | 254 ms - 5.9 s | 0.3 - 4.8 ms |
| Your rank on a board | 0.5 - 1.8 s | ~5 ms (board size cached 10 min) |
| Snapshot, account at the 2,000-follow cap | 46 ms | 16 ms |

Boards read partial indexes and stop after the rows they return; the two whose
value is partly still running ("Hall of fame", "Career total") merge the top N
of each part. The new boards and ranks were checked against a brute-force
evaluation of the old definitions: identical top-100 on all six boards and
identical placings for all 120,000 account/board pairs of a 20,000-account set.

On the client, the per-frame clock used to live at the top of the tree, so the
whole app - every friend row, every board row - re-rendered about 60 times a
second to move the timer's last digits. Only the stopwatch face subscribes to
it now; the People tab went from ~61 renders a second to 1.

---

## Status

| Milestone | State |
|---|---|
| 1. Accounts and the bare timer | Done. Timer, pulse hero, derived elapsed. |
| 2. Cross-platform shell | Desktop done and building, with a self-updating installer. Android/iOS configured, not built here — see below. |
| 3. The heartbeat | Done. Window, per-user and batch sweep, reset flow. |
| 4. Push notifications | Code complete, unverified — needs credentials. |
| 5. The time economy | Done. Ledger, sending, revive, follow/unfollow. |
| 6. Leaderboards | Done. All six boards. |
| 7. Abuse hardening | Done: friend gate, rolling cap, account-age gate, RLS. |

### What was verified, and how

- **100 automated tests** over the domain rules and the store, including lapse
  timing, cap enforcement, revive pricing, clock-to-clock transfers, the
  one-way-follow gate, window anchoring, reload-from-storage, and every
  account rule (anonymous accounts
  refused from sending and reviving, excluded from every board, and the streak
  surviving an upgrade).
- **The SQL was applied to a real PostgreSQL 17** and exercised end to end:
  derivation, the mutual-follow gate (a one-way follow is still refused), the
  rolling cap, overdrafts, revive pricing, double-revive prevention, the
  leaderboards, and the account rules including an anonymous account being
  refused a donation, excluded from the boards, and ranked the moment it is
  upgraded. The RLS was tested under Supabase's default grant posture, and the
  write-guard trigger was tested with a grant deliberately restored.
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
- **The release workflow and a live update on Windows.** There is no
  Windows machine here. The updater was compiled and a signed release build
  was produced on Linux with the same key and config, and the staging script
  and the update flow are unit-tested - but the first real run of
  `release.yml`, and the first update from one installed version to the next,
  are still to be watched.
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

No direct Postgres access? Paste `supabase/deploy.sql` into the SQL editor
instead. It is generated from the migrations - run `npm run db:bundle` after
changing one, rather than editing it by hand.

Then schedule both — see the header comment in each function for the
`cron.schedule` call. `sweep-lapsed` is idempotent and drains any backlog in
5,000-row batches, so running it hourly costs nothing. Both call functions
that only the service role may execute.

Note that every action already sweeps the specific rows it touches, so the
scheduled job is a backstop for accounts nobody is interacting with rather than
the only thing standing between a dead streak and the leaderboards.

## Releasing the desktop app

Windows users get one link that never changes:

```
https://github.com/YungDice/uptime-releases/releases/latest/download/Uptime_Installer.exe
```

The file name carries no version, so the link always serves the current
build. Once installed, the app keeps itself current: it checks on launch and
every six hours, downloads a newer build in the background, and offers a
restart (Account → App → Updates does the same by hand). Restarting costs
nothing, because the clock was never kept by the app.

This repo is private, so the builds are published to a separate **public**
repo, `YungDice/uptime-releases`, which holds nothing but releases. The
installed app polls `latest.json` there; the source never leaves this repo.

### Shipping a version

```bash
npm version patch         # 0.1.0 -> 0.1.1: bumps package.json, commits, tags
git push --follow-tags    # the tag starts .github/workflows/release.yml
```

`package.json` is the only place the version is written - `tauri.conf.json`
and the Account screen both read it. The workflow builds the NSIS installer on
Windows, signs it, and publishes `Uptime_Installer.exe` and `latest.json` as
the new latest release. It refuses a tag that disagrees with `package.json`
and a version that is already out. It can also be started by hand from the
Actions tab, which ships whatever `package.json` says.

### One-time setup

1. **Create the releases repo.** A public repo named `uptime-releases`, with
   a README so it has a commit to hang the release tags on.
2. **Give the workflow a token for it.** A fine-grained personal access token
   with access to `uptime-releases` only and *Contents: Read and write*.
   Save it in this repo as the Actions secret `RELEASES_TOKEN`.
3. **Add the updater's signing key** as two Actions secrets:
   `TAURI_SIGNING_PRIVATE_KEY` (the key file's contents) and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The matching public key is
   `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`; an installed app
   refuses any update that was not signed with it. The key has a password
   because a Windows runner drops an empty environment variable, and Tauri
   then asks for a password with nobody there to type it.
4. **Optionally**, the Actions variables `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`. Without them the release runs on browser
   storage, as a fresh checkout does. `RELEASES_REPO` publishes somewhere
   other than `YungDice/uptime-releases`; change the endpoint in
   `tauri.conf.json` to match.

**Keep a copy of the private key somewhere other than GitHub.** Secrets cannot
be read back, and without the key no installed copy can ever be updated
again: everyone would have to reinstall from a build signed with a new one. To
replace it, run `npx tauri signer generate -w uptime-updater.key` with a
password, put the `.pub` contents in `tauri.conf.json` and the key and
password in the two secrets, and ship one release by installer rather than by
update.

A local `npm run desktop:build` is unaffected: it builds unsigned installers
and never needs the key. The release build adds signing through
`src-tauri/tauri.release.conf.json`.

### The icons

Every platform icon in `src-tauri/icons` is generated from `brand/`:

```bash
npm run icons
```

`brand/app-icon.svg` is the source for desktop and iOS; the Android adaptive
icon gets its own foreground, background and monochrome layers so the launcher's
mask never crops the mark. The installer's sidebar is
`src-tauri/windows/installer-sidebar.bmp`.

---

## Accounts

Playing without an account is a first-class state, not a trial. The clock starts
on the first tap, the streak is real, and nothing nags. Two things stay switched
off until there is an account:

- the account does not appear on any leaderboard
- it cannot send time or revive anyone

Both limits are the same defence. Anonymous accounts are free and unlimited, so
a board that counted them would rank whoever scripted the most signups, and a
ledger that accepted them would be a free supply of senders. Both are enforced
in SQL (`0009_accounts.sql`) and mirrored in the local adapter, so the client
can explain a refusal before the round trip without being the thing enforcing
it.

Signing up is an **upgrade, not a new account**: Supabase keeps the same user id
when an anonymous user attaches an email, so the running clock and the history
carry over. Losing a 95-day run to make an account would be the worst possible
moment to ask for one. `auth.users.is_anonymous` flips itself on that upgrade;
the boards read a mirror of it on `profiles`, refreshed by `uptime_open`, which
is the first thing the app calls after the upgrade - so the account is ranked on
its next read.

---

## Three things to decide

- **Following is the entry to everything social.** Gifts are gated on a mutual
  follow, so a fresh account can do nothing until it follows someone and is
  followed back. Names are tappable everywhere now and open a profile you can
  follow from, so the leaderboards are a discovery surface — but there is still
  no search, no suggestions and no invite links, and the only way to reach
  somebody who is not already on a board is to type their nickname exactly.
  That is probably the next thing worth designing.
- **The name.** `Uptime` is the working name and is used throughout, including
  the bundle identifier `com.yungdice.uptime`. It has not had the gut check
  against the Yung Dice brand that the build prompt asked for.
- **`CHECK_IN_WINDOW`, the revive price and the daily send cap** are the
  numbers that decide how the game feels, and they are guesses. They are named
  constants in `src/core/constants.ts` with matching SQL functions
  (`0001_schema.sql`, `0013_clock_transfers_and_scale.sql`); changing one is a
  one-line edit in each. Now that gifts move real clock time, the cap is also
  what limits friends pooling time into one account to top "Running now".
