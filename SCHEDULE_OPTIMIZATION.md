# Schedule optimization and historical GPA

The branch starts at `21ed50b` on the fork's main, including the complete
registration and scheduling correctness fixes.

## Ranking semantics

- Existing options retain their indices (0–3). Fewest Class Days, Least Idle
  Time and Efficient Week remain at 4–6. Shortest Class Week is appended at 7.
  Only new schedules default to 6;
  saved schedules, migrations and clones retain their stored preference.
- Fewest Class Days counts distinct Monday–Friday days with an actual in-person
  meeting. Required components and pins count. Explicit asynchronous sections,
  remote synchronous meetings and recurring custom events do not add class days.
- Idle time sums gaps between chronological synchronous class meetings on each
  actual calendar date, including weekends. Date ranges are inclusive; meetings
  in different parts of the term never create artificial gaps or trips.
- Travel sums cached walking seconds between consecutive physical meetings on
  each actual date, including every meeting of each selected or pinned CRN.
  Remote meetings do not require a campus journey. Custom events remain conflict
  constraints and are excluded from these class metrics.
- Missing coordinates or matrix routes are unknown, not zero. Travel ranking
  compares unknown-trip count first, then known walking seconds; identical valid
  coordinates confirm zero. No routing requests are made during generation.
- `weeklySpanMinutes` is the longest interval from the first in-person class
  start to the last in-person class end in any actual Monday–Sunday instructional
  week. It includes overnight intervals within that week, required components and
  pins; it excludes async/remote meetings and custom events. Partial-term meetings
  are clipped to their dates. Different weeks are never connected, and weeks with
  no in-person classes contribute zero. A single class contributes its duration.
- Efficient Week compares class days, total idle minutes, weekly span, then travel.
  Shortest Class Week compares class days, weekly span, idle minutes, then travel.
  Stable ties preserve generation order. Metrics are cached per generated
  combination and meeting occurrences are cached per meeting.
- Both options rank every feasible constructed schedule. There is no four-day
  cutoff: five-day schedules remain recommended if required components and
  conflict constraints make a shorter week impossible.

## Generator audit

The existing depth-first search visits the Cartesian product of constructed
course bundles and prunes only conflicts. A brute-force oracle test compares its
complete output across pins, exclusions and recurring events. Verified bundles
still take precedence and duplicate copies of the exact same CRN bundle remain
deduplicated. Timetable-based deduplication has been removed: equal times do not
make different instructors, rooms or registration CRNs interchangeable.

Inference retains the existing campus, component-role and section-prefix rules.
Instructor similarity alone no longer discards alternatives. Inferred links are
still heuristics, not registrar verification; explicit verified links override
them. The search remains exhaustive over constructed alternatives and can grow
exponentially for large requests. No solver rewrite or result cap was added.

## Reset and deletion behavior

Reset Sections removes all pins in the current schedule version and clears the
hover preview. It retains courses, recurring events, exclusions, colors and the
saved sorting preference. Its dialog describes that scope. Cancel, Escape and
backdrop clicks leave the schedule unchanged. Switching term/version cancels an
open confirmation; previews are cleared when the selected schedule changes.

Delete Schedule removes the named version, including its courses and events,
without touching other versions or terms. Both the header and comparison-panel
confirmation are scoped to the displayed term/version and close on context changes.
The header now permits deleting the last version, creating a new empty Primary
with the default preference. Cancel/Escape/backdrop dismissal all close the dialog
and clear its target together.

Deleting the active version selects its previous chronological neighbor, or its
next neighbor when deleting the first. Sorting uses creation time then ID, matching
the header, and selects only surviving IDs. Non-active deletions preserve selection.
Schedule writes use the existing functional Immer/local-storage pipeline. Persisted
selection stays per term and per tab; schedule data continues syncing across tabs.
Delayed selection callbacks are bound to their originating term. Tests exercise
remount persistence, cross-tab deletion recovery and delayed term callbacks with
real storage/extraction hooks. Upstream Firebase remains disabled by default.

## GPA source investigation

`Course.fetchGpaInner()` previously exited when the optional cloud-function base
URL was unset. Its old endpoint was a Firebase read-through cache, not the grade
source itself. The upstream implementation is public:
https://github.com/gt-scheduler/firebase-conf/blob/master/functions/src/course_critique_cache.ts

On October 31, 2026, the published JavaScript at
https://critique.gatech.edu/static/js/main.0c0ac9ab.js still used the public endpoint
`https://c4citk6s9k.execute-api.us-east-1.amazonaws.com/prod/data/course`.
A credential-free GET with `courseID=CS%201331` returned HTTP 200, historical
`raw` records with GPA, instructor names, terms and class-size bands, and
`Access-Control-Allow-Origin: *` for a localhost Origin. The public source repo
documents the courseID query shape, but masks its host:
https://github.com/GT-SGA/Course-Critique#api

The client now reads that public endpoint directly. No private credentials,
upstream Firebase connection or production cloud function is enabled. Course
suffixes are normalized; instructor names are decoded and converted from
`Last, First` to `First Last`. Historical term/instructor data remains available.

GPAs retain the existing class-size-band weighting estimates (5/15/25/40/50).
They are approximate historical averages, not exact student-weighted GPAs or
predictions. The source may lag current semesters or lack a course/professor.
Invalid and out-of-range GPAs are ignored; zero is valid.

Successful decoded results use a versioned seven-day local cache. Concurrent
requests for the same normalized course share a request; responses and network
failures are retained in memory for one minute to limit repeated card requests.
Network failures are not persisted. Requests time out after ten seconds. Storage
failure does not prevent retrieval. Empty or failed results show Unavailable;
Loading appears only while the request is pending. UI effects ignore stale
responses after the displayed course changes.

## Automated validation and benchmarks

- `npm test -- --watchAll=false --runInBand --cacheDirectory=.local-data/jest`
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`
- `npm run test:benchmark -- --cacheDirectory=.local-data/jest-benchmark`

The local cache directory avoids a Windows sandbox permission error when Jest
renames transforms in its default temporary directory. It is gitignored.
The benchmark includes generation and all eight ranking options for 4,096 valid
six-course schedules, plus a conflicting eight-course search. One local run took
32 ms for generation and 439 ms for all ranking options. These are synthetic
regression checks, not limits or guarantees for arbitrary course selections.

## Manual QA checklist

1. Pin classes, hover a recommendation, then Reset Sections. Confirm only pins and
   previews clear; courses, events, exclusions and sort remain after reload.
2. Cancel Reset/Delete using Cancel, Escape and the backdrop; reopen each dialog.
   Switch terms/versions while a confirmation is open and confirm it closes.
3. Delete active first/middle/last versions and a non-active version; verify the
   chosen surviving version and reload. Delete the final version and verify a fresh
   empty Primary. Another term's schedules must remain intact.
4. Compare Efficient Week and Shortest Class Week on partial-term lecture/lab
   schedules with pins and async courses. When five weekdays are unavoidable,
   confirm complete conflict-free recommendations still appear. Existing saved
   sort selections must stay intact; new schedules default to Efficient Week.
5. Check GPA history and offline/unavailable states, and travel ordering for
   pinned multi-meeting sections and unknown rooms, as covered by PR #2.

Validation: 130 tests in 17 suites passed; both benchmarks passed. TypeScript and
repository-wide ESLint passed. Production build succeeded with existing dependency
source-map warnings and a large-bundle advisory. No browser automation was used.
