# Local scheduling harness

Use `node scripts/scheduler.cjs --request request.json` or pipe one JSON request
to stdin. Read [HARNESS.md](HARNESS.md) for the contract and examples. Do not use
browser/computer-use automation for scheduling.

- Screenshots are primary scheduling inputs: identify the semester, visible
  courses, section details and preferences, distinguishing confirmed details
  from uncertain interpretations. Resolve IDs using `courses` / `sections`
  against the CLI's per-term crawler snapshot. Ask only when necessary; never
  invent CRNs or constraints. Search directly and explain the five best valid
  candidates. Do not build OCR or screenshot-processing infrastructure.
- JSON import/export is optional for exact state preservation and transfer to
  the website. When an export is supplied, use `read` before searching. Keep
  private snapshots and exports under ignored `.local-data/`; never commit them.
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
