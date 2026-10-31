# Local scheduling harness

Use `node scripts/scheduler.cjs --request request.json` or pipe one JSON request
to stdin. Read [HARNESS.md](HARNESS.md) for the contract and examples. Do not use
browser/computer-use automation for scheduling.

- Start with `courses` / `sections` and a local crawler snapshot. Use `read` to
  inspect the user's exported version before searching. Keep private snapshots
  and exports under ignored `.local-data/`; never commit them.
- Translate mandatory requests into `hard`; translate preferences into `soft`.
  Clarify actual ambiguity, especially hard versus preferred restrictions.
  Days use `MTWRFSU`; times are integer minutes after midnight. Lab preferences
  use actual CRNs from section inspection. Reuse Oscar; never reimplement its
  registration, conflict, or ranking algorithms.
- Default to five candidates. Compare compact CRNs and metrics; use `inspect`
  only on selected alternatives. Never print the full engine result set.
- Treat infeasibility diagnostics as reasons to discuss relaxation, never
  silently drop mandatory constraints. Search limits are errors, not proof of
  infeasibility. Inferred links still require OSCAR verification.
- Reading, searching, and previewing are read-only. Do not pass
  `--confirm-write` without explicit user approval of the destination and
  selected candidate. Export every CRN in that candidate. Imports append new
  versions, validate term/data, and preserve existing versions with backups.
- Verify changes with `npm run test:harness`, `npm run test:benchmark`,
  `npm test -- --watchAll=false --runInBand --cacheDirectory=.local-data/jest-cache`,
  `npm run lint`, `npx tsc --noEmit`, and `npm run build` as applicable.
- Keep changes on a `codex/` branch. Do not merge or deploy unless asked.
