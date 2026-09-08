# Agent State Memory Design

## Status

Approved direction; implementation plan pending user review of this specification.

## Goal

Give future coding sessions a compact, reliable handoff that survives context compaction and a fresh session without replacing the project's canonical product and architecture documentation.

## Scope

Add a tracked-by-convention `.agent-state/` folder containing three Markdown files and extend the repository-level `AGENTS.md` with read and maintenance instructions.

The project is not currently a Git repository. This setup will not initialize Git or create a commit. The files remain ordinary project files and can be tracked when Git is introduced later.

## Non-goals

- Add scripts, hooks, npm commands, or external storage.
- Automatically infer or generate session state.
- Duplicate the full contents of `docs/projectplan.md` or `docs/architecture.md`.
- Store credentials, private keys, tokens, or other secrets.
- Change application behavior or the frontend architecture.

## File Structure

```text
.
├── .agent-state/
│   ├── project-state.md
│   ├── memory.md
│   └── left-off.md
└── AGENTS.md
```

## File Responsibilities

### `.agent-state/project-state.md`

The durable project snapshot. It records:

- what the product is and its current phase,
- the current architecture and important boundaries,
- the current implementation status,
- important paths and commands,
- known issues and risks,
- the next meaningful milestone.

It should be rewritten when the project status or architecture changes materially. It should stay concise and point to canonical docs for detail.

### `.agent-state/memory.md`

The durable decision and lessons log. It records:

- decisions that future sessions must preserve,
- product constraints and invariants,
- integration-specific discoveries,
- failed approaches and their reasons,
- conventions that are easy to forget.

Entries should include enough context to explain why a decision matters. Stale entries should be corrected or marked obsolete rather than allowed to contradict current canonical documentation.

### `.agent-state/left-off.md`

The short-term session handoff. It records:

- the current objective,
- work completed in the latest session,
- files changed,
- verification commands and results,
- active blockers or open questions,
- exact next steps for the next session.

It is intentionally replaceable. A new session should update it as soon as the active objective changes and before handing work back to the user.

## Agent Workflow

The root `AGENTS.md` will instruct agents to:

1. Read `.agent-state/project-state.md`, `.agent-state/memory.md`, and `.agent-state/left-off.md` before exploring or editing code.
2. Treat the state files as continuity context, while treating detailed product and technical documents as canonical for requirements.
3. Update `project-state.md` when implementation status, architecture, or major risks change.
4. Update `memory.md` when a durable decision, constraint, lesson, or integration discovery is made.
5. Update `left-off.md` after meaningful work and before ending a session, including verification results and the next concrete action.
6. Preserve user-authored or concurrent work and never use state files as a reason to revert unrelated changes.
7. Keep state concise, factual, and free of secrets.

## Initial Seeding

The initial state content will summarize the existing project rather than invent new product decisions:

- `project-state.md` will reflect the React/Vite baseline, the planned Nimiq Treasure Hunt phases, and the current architecture boundaries from `docs/projectplan.md` and `docs/architecture.md`.
- `memory.md` will capture the already-locked Cycle 2 decisions and security invariants, with links to the canonical docs.
- `left-off.md` will identify this state-memory setup as the current objective and state that application implementation has not yet begun in this workspace.

## Acceptance Criteria

- A fresh agent can discover the state folder from `AGENTS.md` without additional explanation.
- Reading the three files gives a useful project snapshot, durable decisions, and an actionable handoff.
- The files have clearly different responsibilities and do not contradict the existing planning docs.
- `AGENTS.md` defines when to read and update each file.
- No scripts, secrets, Git initialization, or application-code changes are introduced.
- The setup remains valid if the project is later placed under Git.

## Verification

Verify the resulting file paths and contents manually, then run the existing project quality checks required for repository changes:

```text
npm run lint
npm run build
```

These checks are expected to validate that the documentation and `AGENTS.md` changes did not affect the application build.
