# Schedule optimization and historical GPA

The branch starts at `21ed50b` on the fork's main, including the complete
registration and scheduling correctness fixes.

## Ranking semantics

- Existing options retain their indices (0–3). Fewest Class Days, Least Idle
  Time and Efficient Week are appended at 4–6. Only new schedules default to 6;
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
- Efficient Week compares class days, then total idle minutes, then the travel
  ranking above. Stable ties preserve generation order. Metrics are cached per
  generated combination and meeting occurrences are cached per meeting.

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
The benchmark includes generation and all seven ranking options for 4,096 valid
six-course schedules, plus a conflicting eight-course search. One local run took
27 ms for generation and 195 ms for all ranking options. These are synthetic
regression checks, not limits or guarantees for arbitrary course selections.

## Manual QA checklist

1. Open an existing saved schedule and confirm its selected sort remains intact.
   Create a new version and confirm Efficient Week is selected.
2. Add a course with required lecture/lab components, pin either component, and
   compare the new sorts. Confirm all components appear in each recommendation.
3. Add a recurring event on an otherwise free weekday. Confirm it blocks
   conflicting classes without adding a class day.
4. Compare travel ordering with multiple meetings and pinned sections. Check
   that an unknown room does not outrank a confirmed short route as zero travel.
5. Open a course and professor history, then simulate offline access or a missing
   GPA. Confirm Loading settles to a numeric GPA or Unavailable; reopen with a
   warm cache. A valid zero GPA must display 0.00.

Validation: 105 tests in 14 suites passed; both benchmarks passed. TypeScript and
repository-wide ESLint passed. Production build succeeded with existing dependency
source-map warnings and a large-bundle advisory. No browser automation was used.
