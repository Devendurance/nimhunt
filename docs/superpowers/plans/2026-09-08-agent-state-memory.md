# Agent State Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Git-tracked `.agent-state/` handoff system so fresh coding sessions can recover the project's current state, durable decisions, and exact next action.

**Architecture:** Use three focused Markdown files with different lifetimes: `project-state.md` for the durable snapshot, `memory.md` for decisions and lessons, and `left-off.md` for the replaceable session handoff. Root `AGENTS.md` defines when agents read and update them; no runtime code, scripts, hooks, or external services are involved.

**Tech Stack:** Git, Markdown, existing React 19 + TypeScript 6 + Vite 8 + Phaser 4 repository, npm.

## Global Constraints

- Track `.agent-state/project-state.md`, `.agent-state/memory.md`, and `.agent-state/left-off.md` in Git.
- Remove the existing `.agent-state/` ignore rule from `.gitignore` without changing unrelated ignore rules.
- Read all three state files before exploring or editing application code.
- Treat `docs/prd.md`, `docs/architecture.md`, `docs/projectplan.md`, and `DESIGN.md` as canonical; state files provide continuity context only.
- Keep state concise, factual, ASCII-first, and free of credentials, private keys, tokens, or other secrets.
- Do not add scripts, hooks, npm commands, external storage, or application behavior.
- Preserve unrelated user or concurrent worktree changes; never revert them.
- Do not commit changes unless the user explicitly requests a commit.
- Verify the repository with `npm test`, `npm run lint`, and `npm run build`; the build includes the TypeScript check through `tsc -b`.

## File Map

- Modify `.gitignore` to allow the state directory to be tracked.
- Modify `AGENTS.md` to make state reading and maintenance part of every agent workflow.
- Modify `.agent-state/project-state.md` with the current product, architecture, implementation status, risks, and next milestone.
- Create `.agent-state/memory.md` with durable product, gameplay, architecture, Nimiq, and security decisions.
- Create `.agent-state/left-off.md` with the current handoff, worktree context, verification results, blockers, and next action.
- Do not modify application source files, canonical product docs, or the approved design spec during implementation.

### Task 1: Enable and document tracked state

**Files:**
- Modify: `.gitignore`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: The approved requirements in `docs/superpowers/specs/2026-09-07-agent-state-design.md`.
- Produces: A repository policy that points every fresh agent to the three state files and defines their update boundaries.

- [ ] **Step 1: Remove only the state ignore rule**

Delete this block from `.gitignore`:

```gitignore
# Agent session state
.agent-state/
```

Leave all existing log, dependency, build, and editor ignore rules unchanged.

- [ ] **Step 2: Add the state workflow to `AGENTS.md`**

Add this section after the response rules and before planning-mode rules:

```markdown
## AGENT STATE CONTINUITY

Before exploring files, asking codebase-specific questions, or editing code, read:

1. `.agent-state/project-state.md`
2. `.agent-state/memory.md`
3. `.agent-state/left-off.md`

These files are continuity context, not the source of truth for product or technical requirements. When they disagree with `docs/prd.md`, `docs/architecture.md`, `docs/projectplan.md`, or `DESIGN.md`, follow the canonical document and correct the state file when appropriate.

Maintain each file at the narrowest useful scope:

- Update `project-state.md` when the implementation phase, architecture, major risk, or meaningful milestone changes.
- Update `memory.md` when a durable decision, constraint, integration discovery, convention, or failed approach should survive future sessions.
- Update `left-off.md` after meaningful work and before ending a session. Include the current objective, completed work, changed paths, verification results, blockers, and the next concrete action.

Keep entries concise, factual, and free of secrets. Do not treat a state-file entry as proof that code works without checking the current repository. Preserve concurrent or user-authored work and never revert unrelated changes because of state-file instructions.
```

- [ ] **Step 3: Inspect the policy diff**

Run:

```text
git diff -- .gitignore AGENTS.md
```

Expected: the diff contains only the removed `.agent-state/` ignore block and the new continuity instructions. No existing planning, testing, database, or UI rules are replaced.

### Task 2: Refresh the durable project snapshot

**Files:**
- Modify: `.agent-state/project-state.md`
- Read for facts: `package.json`, `docs/prd.md`, `docs/architecture.md`, `docs/projectplan.md`, `DESIGN.md`, current `src/` paths

**Interfaces:**
- Consumes: Current repository contents and canonical product/architecture documents.
- Produces: A concise snapshot that lets a new agent understand what NimHunt is, where the active code lives, what is already implemented, and what milestone comes next.

- [ ] **Step 1: Reconcile the snapshot with current repository facts**

Keep the existing file's useful structure, but correct stale values by checking the repository. The snapshot must include:

```markdown
# NimHunt - Project State

> Last updated: 2026-09-08
> Phase: Cycle 2 P4 core Angkor game, active development
```

Record the current package versions from `package.json`, including React 19, TypeScript 6, Vite 8, Phaser 4, React Router 7, Tailwind 4, Vitest 5, ESLint 10, and npm. Do not copy dependency ranges that are not needed for continuity.

- [ ] **Step 2: Record the route and architecture boundaries**

Document the current `/`, `/play`, `/play?dev=nimiq`, and `/play?dev=game` purposes and status. Summarize these boundaries without duplicating `docs/architecture.md`:

- React owns marketing, shell, HUD, dialogs, wallet state, and claim UI.
- Phaser owns the grid scene, rendering, player/enemy movement, and in-map interactions.
- Pure game rules live under `src/game/systems/` and are tested without Phaser.
- `src/game/events/gameEvents.ts` is the typed React-to-Phaser event bridge.
- Nimiq wallet operations belong to the integration/domain layer, never directly inside Phaser.

- [ ] **Step 3: Record implemented gameplay and risks**

Describe the current Room 01 implementation from the source and tests, including 100 HP, deterministic grid movement, hazards, gems, boulder, key/gate, shrine completion, Goblin behavior, sword, potion, reset, and death handling. Keep the current one-room limitation and known visual/audio polish gaps as risks. If a status is not verified by the repository, label it as unverified instead of presenting it as complete.

- [ ] **Step 4: Record the next meaningful milestone and references**

Set the next milestone to continuing the P4 Angkor game toward a complete multi-room playable expedition, while preserving the existing deterministic task and mobile-first controls. Link to `docs/projectplan.md`, `docs/architecture.md`, `docs/prd.md`, and `DESIGN.md` for detail rather than copying them.

### Task 3: Seed durable memory and the session handoff

**Files:**
- Create: `.agent-state/memory.md`
- Create: `.agent-state/left-off.md`
- Modify: `.agent-state/project-state.md` only if Task 2 discovers a cross-file correction

**Interfaces:**
- Consumes: The refreshed project snapshot, canonical docs, current worktree status, and the approved state-file design.
- Produces: Durable context for future decisions and a concrete starting point for the next session.

- [ ] **Step 1: Create `memory.md` with durable invariants**

Use focused sections for canonical sources, product rules, gameplay conventions, architecture boundaries, Nimiq/security rules, and lessons. Seed only decisions that are already documented or visible in the implementation, including:

- Angkor is the only playable Cycle 2 world; Bavaria and Siberia are locked teasers.
- Each run has a visible deterministic task; real NIM eligibility never comes from random chest contents.
- Gems are progression/stat items and are not redeemable or transferable in Cycle 2.
- Reward slots, task eligibility, claim verification, payout amount, daily limits, and replay protection are server-authoritative.
- Private keys and secrets never ship to the frontend or enter Git.
- Phaser and React communicate through typed events, and pure systems remain independent of Phaser.
- Goblin movement is turn-based and deterministic; sword and potion behavior follows the current tested rules.

Each section must point to the relevant canonical document. Do not reproduce whole PRD or architecture sections.

- [ ] **Step 2: Create `left-off.md` for the current handoff**

Use this structure:

```markdown
# NimHunt - Left Off

> Updated: 2026-09-08

## Current Objective

Establish and verify the tracked agent-state continuity workflow.

## Completed

- Record the state setup work completed in this session.
- Summarize the pre-existing Room 01 gameplay milestone without claiming this session authored it.

## Worktree Context

- Record relevant pre-existing modified and untracked paths from `git status --short`.

## Verification

- `npm test`: record the actual result after Task 4.
- `npm run lint`: record the actual result after Task 4.
- `npm run build`: record the actual result after Task 4.

## Blockers and Open Questions

- Backend, server-authoritative expedition validation, and real reward settlement remain future project-plan phases.
- Record only active blockers or unresolved product decisions that affect the next task.

## Next Session

1. Read all three state files and confirm the current worktree before editing.
2. Continue P4 work toward a complete multi-room Angkor expedition.
3. Preserve the deterministic task, mobile controls, and React/Phaser boundary.
```

Replace the instructional lines with factual content before finishing. The handoff must distinguish this state setup from pre-existing application changes.

- [ ] **Step 3: Cross-check the three files**

Check that the snapshot describes durable status, memory contains only durable knowledge, and the handoff contains only current-session context. Remove duplicated detail or any statement that conflicts with the canonical docs.

### Task 4: Verify and finalize the handoff

**Files:**
- Modify: `.agent-state/left-off.md` with actual verification results
- Inspect: `.agent-state/project-state.md`, `.agent-state/memory.md`, `AGENTS.md`, `.gitignore`

**Interfaces:**
- Consumes: The complete state setup from Tasks 1-3.
- Produces: A verified, trackable handoff with evidence from the repository's existing quality checks.

- [ ] **Step 1: Check paths, whitespace, and tracked visibility**

Run:

```text
git diff --check
git status --short
```

Expected: no whitespace errors; `.agent-state/` files appear as trackable files rather than being hidden by `.gitignore`. Existing unrelated worktree changes remain present.

- [ ] **Step 2: Run the test suite**

Run:

```text
npm test
```

Expected: the existing Vitest suite passes. Record the actual test count or failure in `left-off.md`; never write a passing result without command output.

- [ ] **Step 3: Run lint**

Run:

```text
npm run lint
```

Expected: ESLint exits successfully. Record the actual result in `left-off.md`.

- [ ] **Step 4: Run the production build and type check**

Run:

```text
npm run build
```

Expected: `tsc -b` and `vite build` both exit successfully. Record the actual result in `left-off.md`.

- [ ] **Step 5: Review the final diff without committing**

Run:

```text
git diff -- .gitignore AGENTS.md
```

Read the three `.agent-state/` files and confirm that only the approved continuity setup was changed by this work and that no secrets or application-source edits were introduced. Leave the work uncommitted unless the user explicitly requests a commit.
