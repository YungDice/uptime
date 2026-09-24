# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People who already keep streaks and track themselves: WHOOP, Duolingo, Snapchat,
Strava. They know the genre well enough to recognise its conventions on sight and
will judge Uptime directly against those apps. They are not being taught what a
streak is; they are being shown one that works differently.

A consequence worth holding onto: this audience has been burned by daily-streak
anxiety and knows it. The long window is a selling point to them, not a detail.

## Product Purpose

Uptime turns "I started a stopwatch and never stopped it" into a game with real
stakes. One number per user - seconds since their timer last started - drives a
personal streak, a spendable currency, and a set of leaderboards.

Success is a user who keeps a streak running for months without the app ever
demanding anything of them, and who has given time away or rescued someone at
least once. A user who checks in daily out of fear is a failure of the design.

## Positioning

Two things a neighbouring streak app could not truthfully copy:

1. **The streak is a currency.** Time is sent straight off your own clock onto
   a friend's, and spent reviving other people's broken streaks. Nothing else
   in the category lets a streak leave the person who earned it.
2. **Failure is real but never nagging.** The clock can genuinely die, but only
   after 60 days of total silence. Daily-streak apps have to choose between
   stakes and pressure; the long window gets both.

The mechanic is deliberately close to time banking, where communities trade an
hour for an hour - except no labour changes hands, only the time itself.

## Operating Context

Opened rarely and briefly. An engaged user might open it weekly; a healthy user
might open it twice a quarter and still be in perfect standing. Most sessions are
a glance at a number, and the interface has to survive being seen once a month
without becoming unreadable or feeling abandoned.

The moments that actually matter are few and far apart:

- Checking the number, usually with no action taken.
- A push notification near the end of a 60-day window, answered without opening
  the app.
- Coming back to find a streak reset, and being told plainly what happened.
- Sending time to someone, or being asked to rescue a streak that is about to die.

Runs on Windows, Android and iOS from one codebase, with one shared design
language on all three rather than per-OS native conventions.

## Capabilities and Constraints

- Every displayed number is derived from two stored timestamps plus a ledger.
  Nothing ticks server-side; elapsed time is always `now - streak_start`.
- The on-screen counter is a local animation and is explicitly not the source of
  truth. It can drift by seconds.
- A streak ends only by lapsing (60 days without a sign of life), by a deliberate
  reset, or by a voluntary stop. Every past run is kept forever.
- What a user can send comes off their own running clock. Sending takes the
  time off the sender's timer and adds it to the recipient's; receiving adds to
  yours. Only a running clock can send or receive - a lapsed one is revived
  instead.
- A free account can send 6 minutes for every hour on its clock. The
  whole-clock upgrade, a one-off $5 purchase through Stripe, lets it send all
  of it. Not sold inside the phone apps, where store billing rules apply.
- Reviving a broken streak restores half its lost length, paid off the
  reviver's clock at a tenth of what it restores. A headline rescue costs a
  real piece of the rescuer's own run.
- Time only moves between people who follow each other. A fresh account can do
  nothing socially until a follow is mutual. Discovery today is a handle field and
  nothing else - no search, suggestions, or invite links. Explicitly undecided.
- Leaderboards: current streak, longest ever, lifetime total, most donated, most
  received, most rescues.
- Six terms are load-bearing and should stay stable: streak, sending time, the
  check-in window, lapse, revive, and run.
- Window length, revive price and the daily send cap are the numbers that
  decide how the game feels. All three are currently guesses.

## Brand Commitments

- Yung Dice is the publisher. Uptime is a **working name only** and has not had
  a brand gut-check; the runner-up was Keepalive. Do not treat the name as
  settled or build an identity that depends on the word.
- Binding visual references supplied by the user: a WHOOP day-streak screen, a
  generic streak app, and a dark fitness "Toolbox" app. What is binding about
  them is their *structure* - one dominant live number, two or three compact
  supporting stats, and a bar toward the next milestone.
- The flame icon is an explicit anti-reference. It is the default across
  Duolingo, Snapchat and WHOOP and is the one thing the product must not borrow.
- Voice: plain and unapologetic. A lapsed streak says what happened
  ("Your streak reset - the check-in window ran out"), never "Oops".

## Evidence on Hand

Real, cited, and safe to reference:

- A documented iPod stopwatch run of 416 days, and a 2023 iPhone stopwatch found
  at 363 days having survived a full restart.
- Time-banking communities that trade an hour for an hour.
- Reporting on Snapchat streak harms: proxy snapping, paid restoration, and
  400-plus-day streaks described by their owners as anxiety-inducing.

There are **no users, testimonials, metrics, press, or case studies**. Nothing in
the interface may imply a user base, ranking population, or social proof that does
not exist. The seeded cast of friends in the local build is development fixture
data, not real people.

## Product Principles

1. **Nothing runs.** Every number is derived on read. If something has to tick to
   stay correct, it is designed wrong.
2. **The record is never edited.** Resets, lapses, voluntary stops and rescues all
   preserve history. A user can lose a streak but never lose the fact that it
   happened.
3. **Stakes without pressure.** Failure must be real and must never come from the
   product asking for attention.
4. **Giving costs the giver.** Time you send comes off your own clock, so a gift
   is a real sacrifice and a received gift is real time on the recipient's run.
   What never happens is a gift erasing history: past runs stay on the record.
5. **Say what happened.** Especially on failure, and especially when the user was
   not there to see it.

## Accessibility & Inclusion

No formal standard has been set. Two product-specific needs are established:

- The live counter must never be the only way to read state; it updates every
  second and cannot be announced continuously.
- Motion is decorative here and every state must remain legible from colour and
  text alone, so reduced-motion users lose nothing.
