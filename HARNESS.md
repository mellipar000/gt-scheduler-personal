# Headless scheduling

Run locally with the repository's installed Node dependencies:

```powershell
node scripts/scheduler.cjs --request .local-data/request.json
# Or: Get-Content -Raw .local-data/request.json | node scripts/scheduler.cjs
```

The CLI consumes one strict JSON request and emits one compact JSON response:
`{"ok":true,"result":...}`. Errors return `ok:false` and exit code 1.
Logs go to stderr. No browser, credentials, or cloud writes are used. The
launcher transpiles application TypeScript in memory using the
existing TypeScript dependency. It calls Oscar's crawler decoder, registration
bundle generator, conflict checks, sorting options, and schedule metrics.

All paths are relative to the current working directory. `term` is required
for every operation. Except `read`, operations automatically use a per-term
cache under `.local-data/crawler/`, refreshing the published crawler JSON when
missing or at least 60 minutes old. Downloads are validated before atomic
replacement. If refresh fails, the last valid snapshot is used with a warning
on stderr; without one, the request fails. An explicit `dataFile` bypasses the
cache and refresh, which is useful for tests and verified local snapshots. The
crawler format has no term identifier, so pair explicit files with the correct
term. Live seat and GPA information is not fetched.

## Screenshot-first searches

Codex can interpret a screenshot directly: identify its semester, visible
courses, section details and schedule preferences; state which details are
uncertain. Use `courses` and `sections` to resolve actual IDs and CRNs, then
translate confirmed mandatory restrictions into `hard` and preferences into
`soft`. Search and rank with the CLI, returning the five best candidates with
brief explanations. Ask only when an ambiguity prevents a valid search; do
not invent missing CRNs or constraints. No OCR, image-processing pipeline or
browser automation is needed. An exported schedule is optional, and useful
when exact existing state must be preserved or a candidate transferred back.

## Requests

Common fields: `op`, `term`, `dataFile`, `topK` (default 5, maximum 50).
Unknown fields fail validation. The executable schemas are in
`src/harness/cli.ts` and `src/data/scheduleTransfer.ts`.

| Operation | Additional fields | Result |
| --- | --- | --- |
| `courses` | `query`, `offset` | Paged course IDs, titles, section counts |
| `sections` | `course`, `offset` | Paged CRNs, meetings, instructors, restrictions, link status |
| `read` | `scheduleFile`, optional `versionId` | Schedule contents from an exported version or v3 store |
| `search` | `courses`, `hard`, `soft`, optional `scheduleFile` / `versionId` | Count, diagnostics, top-K ranked CRNs and metrics |
| `inspect` | `crns` | Detailed sections and metrics for chosen CRNs |
| `export` | `crns`, `courses`, `name`, optional source schedule | Portable version with the complete candidate pinned |
| `import` | `scheduleFile`, `storeFile` | Preview of appending a portable version to an exported v3 store |

`scheduleFile` supplies courses, pins, exclusions, events, colors and palette.
Explicit `courses` and `hard` arrays override their source counterparts; omitted
ones inherit them. Search defaults to Efficient Week even if a source version
uses another sort; specify `soft.sort` to compare ranking strategies.
For stores containing several versions, `read`/`search` require `versionId`.
Legacy stores must first be opened and exported by the website's migration flow.

`hard` supports `pinnedCrns`, `excludedCrns`, `avoidDays`, `earliestStart`,
`latestEnd`, and `events`. Times are integer minutes after midnight; days use
`M T W R F S U`. Events have `id`, `name`, `days`, and `period:{start,end}`.
Source events can also preserve location/edit metadata. Hard day/time rules
cover timed meetings, including remote synchronous classes; asynchronous
classes remain eligible. Registration and conflict decisions remain in Oscar.

`soft` supports `preferCrns`, `avoidDays`, and `sort`. Each missing preferred
CRN and each meeting touching an avoided day adds one preference penalty.
Lower penalty wins first; the existing application sort breaks penalty ties.
Missing preferred CRNs in the snapshot are errors. A preference for a CRN
outside requested courses cannot improve any candidate.

Sort indices: 0 Most Compact, 1 Earliest Ending, 2 Latest Beginning,
3 Least Travel Time, 4 Fewest Class Days, 5 Least Idle Time,
6 Efficient Week (default), 7 Shortest Class Week. Metrics retain the engine's
semantics: class days and weekly span concern physical attendance; idle minutes
and trips accumulate across actual semester meeting dates. Unknown walking
routes are counted separately from confirmed zero travel. See
[SCHEDULE_OPTIMIZATION.md](SCHEDULE_OPTIMIZATION.md).

## Natural-language translations

“No Friday classes, prefer this lab, minimize gaps”:

```json
{"op":"search","term":"202608","dataFile":"src/data/beans/__fixtures__/ae2610-202608.json","courses":["AE 2610"],"hard":{"avoidDays":["F"]},"soft":{"preferCrns":["84092"],"sort":5},"topK":5}
```

“Prefer Friday off, but keep alternatives” uses `soft.avoidDays:["F"]`.
“Only this lab” uses `hard.pinnedCrns:["84092"]`.

“Nothing before 10, finish by 5” adds
`"hard":{"earliestStart":600,"latestEnd":1020}`.

“Compare a shorter week against fewer gaps”: run the same hard constraints
with sorts 7 and 5, then inspect only the differing candidates:

```json
{"op":"inspect","term":"202608","dataFile":"src/data/beans/__fixtures__/ae2610-202608.json","crns":["86554","84092"]}
```

Inspect sections before selecting labs:

```json
{"op":"sections","term":"202608","dataFile":"src/data/beans/__fixtures__/ae2610-202608.json","course":"AE 2610","topK":5,"offset":0}
```

## Safe website round trip

1. On the website, expand **Schedule JSON import / export** and export the
   current version. This uses an ordinary user file action.
2. Use `read` with `scheduleFile` to inspect that file, then `search` with the
   same file. This preserves existing pins, exclusions and events unless
   explicitly overridden.
3. Select a candidate's complete `crns`, including lecture/lab components.
   Put an `export` request in `.local-data/export-request.json`:

```json
{"op":"export","term":"202608","dataFile":"src/data/beans/__fixtures__/ae2610-202608.json","courses":["AE 2610"],"crns":["86554","84092"],"name":"Alternative A"}
```

```powershell
# Preview only; creates no file:
node scripts/scheduler.cjs --request .local-data/export-request.json --output .local-data/alternative.json
# After explicit approval:
node scripts/scheduler.cjs --request .local-data/export-request.json --output .local-data/alternative.json --confirm-write
```

4. On the website, select the exported JSON file to preview its name, courses,
   and CRNs. **Confirm import as new version** validates it against the loaded
   term, saves a backup of that term's existing versions to local storage and
   downloads a backup JSON, then appends/selects the new version. Cancel and
   file selection alone do not write schedules. Backup-storage failure aborts
   the import. Existing versions and friend shares are preserved; the new
   version starts unshared. Term/version changes discard pending previews.

For offline store editing, `import` accepts a `storeFile` containing the native
v3 `{version:3,terms:{...}}` shape and a portable `scheduleFile`. With
`--output STORE --confirm-write`, it writes a new store containing all original
versions plus the imported version. It never overwrites a version ID. This
operation edits a file, not browser storage; use the portable version import
control to apply a candidate to the website.

All CLI output files require both `--output` and `--confirm-write`. Stdout alone
does not write schedules; shell redirection is managed by the caller. Existing
destination files get unique byte-for-byte `.bak` backups. Writes use an
exclusive sibling lock, temporary file, and rename. A changed source store
aborts an in-place import. Do not manually remove a live writer's lock.

## Bounds, diagnostics and checks

Searches are exhaustive within limits: 50,000 feasible combinations, 1,000,000
DFS nodes, 60-second process timeout, 50 MiB input files, 4 MiB response buffer.
A limit raises an error rather than returning a partial ranking or claiming
infeasibility. Narrow courses, pin sections, or add exclusions, then retry.
The current engine materializes bounded combinations internally; only top-K
summaries enter model context. Course/section lists page with `nextOffset`.
Candidate CRNs are stable handles for `inspect` and `export`; ranking ties retain
the deterministic engine traversal order for a fixed snapshot.

Zero candidates return the engine's diagnostics: stale/missing courses or CRNs,
pins excluded or conflicting, incomplete bundles, missing time data, recurring
event conflicts, or cross-course conflicts. Do not automatically relax hard
constraints. Inferred registration links are flagged; confirm them in OSCAR.

```powershell
npm run test:harness
npm run test:benchmark
npm test -- --watchAll=false --runInBand --cacheDirectory=.local-data/jest-cache
npx tsc --noEmit
npm run lint
npm run build
```

Tests compare CLI rankings with Oscar on a deterministic fixture, enforce hard
and soft rules, exercise JSON subprocess round trips, validate backups and dry
runs, and check search/output limits. Website transfer tests run in jsdom and
exercise preview, cancellation, confirmation and failed backups without GUI
automation. Timing thresholds are generous regression guards, not a guarantee
for every real-world dataset or machine.
