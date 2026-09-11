# CRITICAL RULES - MUST FOLLOW

## RESPONSES

- Keep responses concise and to the point - unless the user asks otherwise

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

## PLANNING MODE

- Always ask clarifying questions
- Never assume design, tech stack or features
- Use deep-dive sub-agents to assist with research
- Use deep-dive sub-agents to review the different aspects of your plan before presenting to the user

## CHANGE / EDIT MODE

- CRITICAL SPEED RULES: Do not and Never spawn a subagent. Execute all file modifications, multi-file architectural migrations, syntax fixes, and local terminal commands inline.


- Use the best model for the task - premium models for complex tasks (like coding) and mid-tier models for simpler tasks, like documentation
- After completing features (large or small), always run commands like lint, type check and next build to check code quality


## DATABASE SCHEMA CHANGES

- Whenever you make changes to the database schema, ALWAYS run the drizzle generate and migrate commands
- NEVER run drizzle push!

## TESTING

- Use any testing tools, libraries available to the project for testing your changes
- Never assume your changes simply work, always test!
- If the project does not have any testing tools, scripts, MCP tools, skills, etc. available for testing, ask the user whether testing should be skipped.

## UI DESIGN

- Always follow/reference the UI design system when creating or reviewing components or pages.
- Design System: @DESIGN.md
