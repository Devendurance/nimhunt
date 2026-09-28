# NimHunt Production Build Plan

**Status:** Approved design baseline  
**Product:** NimHunt  
**Scope:** Adventurer identity, profiles, lifetime progression, public player identity, Allies, Treasure Bank navigation, settings, and mobile gameplay polish  
**Primary surface:** `/play` mobile-first app shell  
**Implementation model:** OMP multi-agent workflow using `/build` as lead engineer/orchestrator

---

## 1. Product Objective

NimHunt should stop presenting players primarily as wallet addresses and instead treat each real player as a persistent **Adventurer**.

The wallet remains the secure underlying owner and the authoritative identity for expedition proof, claims, and payouts. The game layer gains a separate immutable `player_id` used for profiles, social relationships, public reputation, cosmetics, and future progression.

The intended player experience is:

```text
wallet ownership
      ↓
Adventurer identity
      ↓
daily expeditions
      ↓
persistent stats + reputation
      ↓
Allies / rivalry / future social play
      ↓
real NIM rewards through the existing wallet-led reward system
```

The blockchain should become less visually dominant, not less secure.

---

## 2. Non-Negotiable Architecture

### 2.1 Existing proof/reward system remains wallet-authoritative

Do not rewrite the working proof or money pipeline.

```text
wallet
  ↓
expedition runs
  ↓
checkpoint/replay proof
  ↓
verified result
  ↓
reward claim
  ↓
payout
```

Profiles and social features may read verified gameplay facts but must not become authoritative for payout eligibility or fund movement.

### 2.2 New game/social identity uses immutable `player_id`

```text
wallet
  ↓ proves ownership of
Adventurer Profile
  ↓
player_id
  ├─ profile
  ├─ avatar
  ├─ lifetime stats
  ├─ Allies
  ├─ public leaderboard identity
  ├─ future achievements/titles
  └─ future progression
```

The wallet answers **who owns this Adventurer**.  
The `player_id` answers **who this Adventurer is inside NimHunt**.

### 2.3 Existing run tables are not migrated to `player_id`

Historical and future gameplay records may continue using wallet identity. Player-facing services resolve profile/stats through `adventurer_profiles.wallet`.

This avoids unnecessary risk to the security-critical ledger.

---

# 3. Approved Player Identity Rules

## 3.1 Display names

Display names are:

- globally unique;
- unique case-insensitively;
- 3–20 characters;
- v1 allowed format: letters, numbers, `_`, and single internal spaces;
- trimmed;
- no repeated spaces;
- no leading/trailing spaces;
- checked against reserved/system names;
- checked against a server-side basic abuse/profanity denylist.

Examples that must collide:

```text
Endy
endy
ENDY
```

Recommended storage:

```text
display_name
normalized_display_name
```

`normalized_display_name` has a database-level unique constraint so concurrency cannot create duplicates.

Reserved examples include:

```text
NimHunt
Nimiq
Admin
Administrator
Moderator
Treasury
Support
Official
System
```

## 3.2 Rename model

Display names may change once every **30 days**.

Rules:

- the new name must be available;
- cooldown is enforced by the server/database, not the client;
- `display_name_changed_at` is authoritative;
- the 30-day clock starts at profile creation;
- the old name becomes available immediately after a successful rename;
- rename does not change `player_id`, wallet ownership, Allies, stats, rewards, or history;
- renames require a fresh wallet signature.

## 3.3 Practice vs real expeditions

**Practice mode does not require an Adventurer profile.**

**Real/reward-eligible product expeditions require an Adventurer profile.**

First-time flow:

```text
connect wallet
      ↓
profile exists?
  yes      no
   ↓        ↓
continue   choose unique name + avatar
           ↓
           sign profile creation
           ↓
           profile created
           ↓
           continue intended expedition
```

Important production sequencing rule: the enforcement gate must not be activated until the onboarding UI is live. P1 may build the gate contract/server capability, but P2 turns enforcement on with the complete UX.

## 3.4 Existing players

Do not manufacture profile rows or fake names for historical wallets.

When an existing player returns:

```text
known wallet history
      ↓
no profile
      ↓
Claim your Adventurer identity
      ↓
choose name + avatar
      ↓
sign
      ↓
historical verified stats appear automatically
```

No historical expedition rewrite is required.

---

# 4. Avatar Model

Launch with **curated NimHunt avatars only**.

No user-uploaded profile images in this release.

Initial direction:

- 12–20 illustrated Adventurer portraits;
- all visually consistent with NimHunt;
- starter avatars are available during profile creation;
- future avatars may be unlocked through achievements, worlds, streaks, seasons, or progression.

Profiles store an `avatar_id`, not an arbitrary URL.

Recommended schema concept:

```text
adventurer_avatars
avatar_id
starter
active
sort_order
```

Future unlock support can be added with:

```text
adventurer_avatar_unlocks
```

without changing profile identity.

---

# 5. Adventurer Profile Data Model

Recommended core profile table:

```text
adventurer_profiles

id                       UUID PRIMARY KEY
wallet                   TEXT UNIQUE NOT NULL
display_name             TEXT NOT NULL
normalized_display_name  TEXT UNIQUE NOT NULL
avatar_id                TEXT NOT NULL
display_name_changed_at  TIMESTAMPTZ NOT NULL
created_at               TIMESTAMPTZ NOT NULL
updated_at               TIMESTAMPTZ NOT NULL
```

Everything new in the social/game-world layer references `id`.

---

# 6. Adventurer Authentication

Do not repurpose expedition run sessions or wallet recovery sessions.

Create a dedicated Adventurer authentication boundary.

## 6.1 Creation

Canonical signing payload:

```text
NIMHUNT_CREATE_ADVENTURER_V1
wallet
displayName
avatarId
challenge
issuedAt
expiresAt
```

Flow:

```text
server challenge
→ player chooses name/avatar
→ wallet signs canonical payload
→ server verifies signature
→ atomic profile creation
→ Adventurer session established
```

## 6.2 Returning session

Canonical payload:

```text
NIMHUNT_ADVENTURER_SESSION_V1
wallet
challenge
issuedAt
expiresAt
```

Recommended Adventurer session lifetime: **30 days**.

Use an opaque capability cookie:

```text
HttpOnly
Secure
SameSite=Strict
Path=/api
```

Only a hash of the session capability is stored server-side.

## 6.3 Rename

Canonical payload:

```text
NIMHUNT_RENAME_ADVENTURER_V1
playerId
currentName
newName
challenge
issuedAt
expiresAt
```

Avatar-only edits may use the valid Adventurer session without a rename signature.

---

# 7. Lifetime Stats

All permanent stats must come from authoritative server-verified gameplay, never browser counters.

## 7.1 Lifetime Gems

Definition:

> Sum of verified `gemsCollected` across all real/product expeditions for the owning wallet.

Rules:

- successful verified runs count;
- failed verified runs also count;
- dying after collecting gems does not erase them;
- Practice never counts;
- totals persist across worlds and seasons.

## 7.2 Expeditions Completed

Use the same trusted mission-completion semantics already used by the production Monthly Heroes logic.

## 7.3 Best Streak

Use qualifying completed expedition days, measured in UTC.

## 7.4 Storage strategy

Initially **derive lifetime stats from authoritative run history** rather than maintaining a second mutable `profile_stats` truth.

Add indexes/cache where useful.

If future scale makes derivation expensive, introduce a rebuildable projection/materialized stats layer later.

---

# 8. Public vs Private Profile Data

## 8.1 Public Adventurer profile

May expose:

```text
playerId
displayName
avatarId
future selected title
lifetimeGems
expeditionsCompleted
bestStreak
future earned achievements
allyCount
current-month public Hero placements where appropriate
```

## 8.2 Never expose publicly

Do not expose:

```text
wallet address
NIM earned/delivered
reward claims
reward history
payout state
pending treasure
private settings
blocked users
session/challenge metadata
security internals
```

Public lookup is by immutable `playerId`, not display name.

Exact-name player search is intentionally deferred.

---

# 9. Hall of Heroes Identity

Leaderboard scoring remains based on existing verified gameplay logic.

Only the public identity layer changes.

Current concept:

```text
rank
maskedWallet
value
```

Target concept:

```text
rank
playerId | null
displayName
avatarId | null
value
```

For historical players without a claimed profile:

```text
displayName: "Unnamed Adventurer"
playerId: null
avatarId: null
```

Their verified ranking remains valid.

Do not expose their wallet.

Once they create a profile, the same ranking naturally resolves to their chosen identity.

---

# 10. Allies Social Model

Relationships are mutual, not follower-based.

Flow:

```text
Add Adventurer
→ request sent
→ recipient accepts
→ both become Allies
```

Terminology:

- action: **Add Adventurer**
- established relationship: **Ally / Allies**

## 10.1 Limits

Server-enforced:

- max 100 accepted Allies;
- max 25 outgoing pending requests;
- max 25 incoming pending requests.

## 10.2 Requests

Recommended:

```text
adventurer_ally_requests
id
sender_id
receiver_id
status
created_at
resolved_at
```

Statuses:

```text
PENDING
ACCEPTED
DECLINED
CANCELLED
```

Server rules:

- no self-request;
- no duplicate pending request;
- no request to an existing Ally;
- no request when blocked;
- caps enforced server-side.

## 10.3 Established Allies

Recommended:

```text
adventurer_allies
adventurer_a_id
adventurer_b_id
created_at
```

Store one deterministic pair row per friendship.

Accept is atomic:

```text
lock request
→ verify both players are below 100
→ create relationship
→ mark request accepted
```

## 10.4 Remove

Removing an Ally ends the relationship for both players.

## 10.5 Blocking

Ship blocking with the social layer.

Recommended:

```text
adventurer_blocks
blocker_id
blocked_id
created_at
```

Blocking atomically:

1. removes existing Ally relationship;
2. cancels pending requests between the pair;
3. creates the block;
4. prevents future requests until unblock.

Do not notify the blocked person that they were blocked.

No chat, DMs, comments, or free-text social feed in this release.

---

# 11. Mobile UX

## 11.1 First-time onboarding

After wallet connection, if no profile exists, present:

```text
CREATE YOUR ADVENTURER

[ avatar selector ]

Display name
[________________]

✓ Name available

[ CREATE ADVENTURER ]

Try Practice instead
```

Required states:

- checking;
- available;
- taken;
- invalid;
- reserved;
- signature requested;
- signature cancelled;
- server/session failure;
- success;
- retry.

Name availability checks are advisory; atomic creation remains authoritative.

## 11.2 Header

Target:

```text
NIMHUNT                  💎 428  [avatar]
```

Wallet address should no longer be the normal visible identity.

Tap avatar → My Adventurer.

Lifetime Gems are visible on `/play`, but during an active expedition the HUD should show only run-local gem progress such as:

```text
💎 4 / 6
```

to avoid confusing lifetime totals with mission objectives.

## 11.3 My Adventurer

Own profile should include only live features:

```text
[avatar]
Endy

💎 Lifetime Gems
🏕 Expeditions Completed
🔥 Best Streak

Allies        (once P4 is live)

[Edit Profile]
[Settings]
```

Do not show dead/fake achievements or XP sections before those systems exist.

## 11.4 Public profile sheet

Tapping a profile-enabled leaderboard name opens a mobile bottom sheet.

Show:

```text
avatar
display name
future selected title
lifetime gems
expeditions completed
best streak
ally count
future achievements
```

Social CTA appears only when P4 is live.

States:

```text
+ ADD ADVENTURER
REQUEST SENT
ACCEPT REQUEST
ALLY
```

Own profile uses `View My Adventurer`.

---

# 12. App Navigation

Bottom navigation becomes:

```text
Hunt · Missions · Heroes · Bank
```

Profile does not take a fifth bottom-nav slot.

Tap avatar for My Adventurer.

## 12.1 URL state

Move primary app-tab state out of local-only state and into predictable URL/history semantics.

Conceptually:

```text
/play
/play?tab=missions
/play?tab=heroes
/play?tab=bank
```

Preserve and do not casually rewrite existing production-sensitive query semantics:

```text
?run=
?runId=
?practice=
```

Back/refresh/deep-link behavior should feel like a real app.

---

# 13. Treasure Bank

Treasure Bank becomes its own bottom-navigation destination.

Remove the full duplicated Bank section from Hunt and Missions.

Hunt may show contextual reward messages only, e.g.:

```text
✓ 100 NIM secured
View Bank →
```

Bank uses real reward data only.

Initial structure:

```text
TREASURE BANK

Pending NIM
Lifetime treasure
Delivered rewards

RECENT TREASURE
date · mission · amount · status
```

Optional deeper detail for delivered rewards may expose transaction proof when useful.

Keep blockchain detail one level deeper than the primary game experience.

---

# 14. Settings

Settings is reached from My Adventurer.

Only ship controls that really work.

Initial categories:

```text
PROFILE
Edit Adventurer

GAME
Sound / Music

ACCOUNT
Connected wallet
Switch account if supported by current wallet flow

SOCIAL
Blocked Adventurers

ABOUT
How NimHunt works
Version
```

Future haptics toggle appears only when haptics are actually implemented.

Device-local preferences should remain local where appropriate rather than creating an oversized database settings table.

---

# 15. D-Pad / Mobile Gameplay Polish

Current buttons are approximately `52×48px`.

Target normal-phone size:

```text
~60×60px
```

Responsive narrow-screen fallback:

```text
~56×56px
```

Test at minimum:

```text
320px
360px
390px
430px
```

Keep deterministic four-direction grid movement.

Do not replace with a joystick in this release.

Future polish may include:

- haptic movement feedback;
- damage feedback;
- gem-pickup feedback;
- boulder feedback;
- mission-complete feedback;
- pressed states;
- thumb-reach QA;
- safe-area QA.

---

# 16. Production Milestones

## P1 — Adventurer Identity Foundation

### Scope

Build the security/data/server foundation.

Add:

```text
014_adventurer_identity.sql
```

Core capabilities:

- `adventurer_profiles`;
- `adventurer_avatars`;
- Adventurer profile challenges;
- Adventurer sessions;
- name normalization/validation;
- database uniqueness;
- reserved-name enforcement;
- profile creation challenge/signature flow;
- returning Adventurer session challenge/signature flow;
- own-profile server contract;
- public-profile server contract;
- lifetime stat derivation from verified runs;
- historical-player stat recovery by wallet join;
- profile-required expedition gate capability.

**Do not activate the real-expedition gate in production until P2 onboarding is ready.**

### Frozen shared contracts before parallel build

Types:

```text
AdventurerProfile
PublicAdventurerProfile
AdventurerStats
AdventurerAvatar
AdventurerSession
```

Error vocabulary:

```text
PROFILE_NOT_FOUND
PROFILE_ALREADY_EXISTS
DISPLAY_NAME_INVALID
DISPLAY_NAME_TAKEN
DISPLAY_NAME_RESERVED
DISPLAY_NAME_COOLDOWN
AVATAR_UNAVAILABLE
ADVENTURER_SESSION_INVALID
CHALLENGE_INVALID
CHALLENGE_EXPIRED
SIGNATURE_INVALID
```

Canonical payload versions:

```text
NIMHUNT_CREATE_ADVENTURER_V1
NIMHUNT_ADVENTURER_SESSION_V1
NIMHUNT_RENAME_ADVENTURER_V1
```

Stat semantics:

- lifetime gems = verified gems from successful + failed real runs;
- completed = existing trusted completion semantics;
- best streak = qualifying completion days, UTC;
- Practice = zero contribution.

### Parallel packages

**Database/security**
- migration 014;
- tables/constraints/indexes/RLS/RPCs;
- concurrency safety;
- permission matrix.

**Server identity**
- challenge generation;
- signature verification;
- session cookie;
- own/public profile endpoints.

**Stats/domain**
- historical lifetime stats;
- typed public/own contracts;
- reuse trusted verified-run semantics.

**Verifier**
- name concurrency;
- challenge replay;
- wrong wallet;
- expiry;
- session invalidation;
- old-player stats;
- Practice exclusion;
- proof/reward regressions.

### P1 gate

Must prove:

```text
Endy + endy cannot coexist
simultaneous same-name claims → exactly one wins
wrong wallet cannot create profile
expired/replayed challenge rejected
existing verified gems appear on new profile
failed verified runs contribute gems
Practice contributes zero
public profile leaks no wallet/reward data
existing reward/proof tests remain green
```

Owner applies `014_adventurer_identity.sql` only after local verification.

---

## P2 — Adventurer Onboarding + My Profile

Build:

- first-time profile onboarding;
- starter avatar picker;
- name availability UX;
- profile signing UX;
- returning session restore;
- header player identity;
- Lifetime Gems header;
- My Adventurer;
- edit avatar;
- legacy-player “welcome back / recovered stats” behavior;
- activate the real-expedition profile requirement only when onboarding is live;
- Practice bypass.

Gate:

```text
new wallet → create profile → start real expedition
existing wallet → create profile → historical stats appear
Practice works without profile
refresh/session recovery works
cancelled signing is safe/recoverable
```

---

## P3 — Public Identity + Hall of Heroes

Build:

- leaderboard identity contract;
- avatar + display name rows;
- `Unnamed Adventurer` fallback;
- no masked/full wallet in public response;
- clickable claimed-profile identities;
- public Adventurer sheet;
- privacy regression tests.

Do not show a dead Add Adventurer button before P4.

---

## P4 — Allies + Safety

Add:

```text
015_adventurer_social.sql
```

Build:

- Ally requests;
- accept/decline;
- established Allies;
- 100 Ally cap;
- 25/25 pending caps;
- My Adventurer Allies entry;
- Requests UI;
- Ally list;
- Add Adventurer CTA;
- Remove Ally;
- Block/unblock;
- atomic social operations.

Owner applies migration 015 after local verification.

---

## P5 — Bank + Settings + Navigation

Build:

- four-tab bottom nav;
- URL-backed app-tab navigation;
- standalone Treasure Bank;
- remove duplicated full Bank from Hunt/Missions;
- contextual reward links from Hunt;
- Settings;
- blocked-list management;
- 30-day rename UX/signature;
- real rename countdown;
- preserve expedition URL semantics.

---

## P6 — Mobile Gameplay Polish

Build:

- responsive larger D-pad;
- explicit run-local vs lifetime gem distinction;
- safe-area/thumb reach polish;
- responsive HUD checks;
- haptics + real Settings toggle if supported cleanly;
- mobile regression QA.

No joystick rewrite.

---

# 17. Deferred Post-Release Systems

Not part of P1–P6:

## P7
Achievements + titles

## P8
Explorer Level / XP

## P9
Allies leaderboard + direct challenges

## P10
Seasonal/world progression and broader social events

Architecture should permit these later without prematurely shipping dead UI.

---

# 18. OMP Execution Rules

Every substantial build milestone must begin through the custom `/build` command.

`/build` acts as lead engineer/orchestrator:

```text
understand
→ inspect repository truth
→ scout
→ freeze shared contract
→ decompose non-overlapping packages
→ parallel specialist build
→ central integration
→ verifier
→ repair
→ report
```

Rules:

- milestone-scoped work only;
- freeze shared contracts before parallel implementation;
- avoid multiple builders editing the same central integration files simultaneously;
- preserve existing repository patterns unless the design requires a deliberate change;
- tests before claiming complete;
- no “PASS with gaps”;
- distinguish code-complete from production-complete;
- do not stage `.agent-state/*` or `videos/`;
- do not use `git add -A`;
- commit only intentional repository changes.

---

# 19. Owner-Side Production Operations

The coding agent is not assumed to own Supabase/Vercel credentials.

Standard production workflow:

```text
agent implements + tests + commits + pushes
        ↓
owner performs privileged dashboard action when required
        ↓
agent verifies production afterward
```

Expected owner checkpoints:

### P1
Apply:

```text
server/ledger/sql/014_adventurer_identity.sql
```

### P4
Apply:

```text
server/ledger/sql/015_adventurer_social.sql
```

If a new Vercel environment variable is truly required, the agent must report:

- exact variable name;
- why it is necessary;
- whether it is public or secret;
- expected environment(s).

The owner enters it.

---

# 20. Security / Financial Safety Guardrail

For every P1–P6 build:

> Do not modify payout execution, payout scheduler state, claim economics, daily reward capacity, reward amount, treasury credentials, or send NIM as part of this work.

Profiles/social may read trusted gameplay/reward data only where the approved feature requires it.

No manual payout execution is part of this plan.

---

# 21. Definition of Done

The full P1–P6 release is complete when:

- real players have wallet-owned Adventurer profiles;
- globally unique display names are enforced server-side;
- curated avatars work;
- lifetime Gems are authoritative and historical;
- old players retain prior gameplay progress;
- Hall of Heroes uses Adventurer identity rather than wallet identity;
- public profiles expose only approved game reputation data;
- mutual Allies and blocking work under enforced caps;
- Bank is a dedicated app destination;
- Settings and rename lifecycle work;
- mobile navigation/back/refresh behavior is predictable;
- D-pad is more ergonomic;
- Practice remains frictionless;
- real expeditions require an Adventurer identity only after onboarding ships;
- proof/reward/payout semantics remain intact;
- all affected tests, typechecks, lint, build, migration checks, and production verification gates pass.

---

# 22. Product Principle

The final experience should make the player think:

> “That’s Endy. He has 2,482 Gems and he’s #3 Relic Keeper.”

—not—

> “That’s wallet NQ21…”

NimHunt’s wallet remains the secure owner.  
The Adventurer becomes the person the game remembers.
