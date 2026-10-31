# Schedule correctness

## Reproduction

Captured October 31, 2026 from [Fall 2026 crawler data](https://gt-scheduler.github.io/crawler-v2/202608.json). The checked-in fixture retains AE 2610 and original shared caches.

- A, CRN **86554**, is labeled `Breakout*`, Wednesday 12:30-13:20 (50 minutes).
- A01-A11 are `Supervised Laboratory*`, each with a separate CRN and 115-minute meeting. A01, CRN **84090**, meets Monday 15:30-17:25.
- The original `isLecture()` recognized only `Lecture`; `hasLab` required both lecture-only and lab-only sections. AE 2610 therefore became independent singleton choices.
- Running the original Oscar, Course, and helpers on this fixture reproduced **12 singleton recommendations**, with `['86554']` first under Most Compact.

[OSCAR View Linked for 86554](https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/searchResults/getLinkedSections?term=202608&courseReferenceNumber=86554) confirms 11 lab alternatives. Its captured response is `src/data/beans/__fixtures__/ae2610-linked.html`. Live import verified reciprocal links from all labs. [Registrar registration assistance](https://registrar.gatech.edu/registration/registration-assistance) documents View Linked and Add All. Section names alone do not prove links.

Other defects: the fallback silently skipped courses; links were guessed using prefixes, instructors, and unmatched sections; new lecture/lab pairs were not checked against each other; fully pinned sections bypassed completeness, incompatibility, exclusion, and conflict checks.

## Fix and crawler contract

Generation uses complete registration bundles. A bundle can have one CRN with multiple meetings, two linked CRNs, or three or more mandatory components. It must contain all course pins and satisfy exclusions, internal and external time conflicts, and recurring events. Absent verification triggers inference; missing sections, invalid verified requirements, or impossible component combinations produce a diagnostic. Invalid meeting alternatives are rejected with a diagnostic; independently verified alternatives can still be returned. Explicit asynchronous sections can have no scheduled meetings. Weekend conflicts are included.

`getCombinations()` keeps its array API. `getCombinationResult()` adds diagnostics displayed in the recommendations panel. As before, `combination.crns` contains additions to pinned CRNs; the full schedule is their union. Sorting functions remain unchanged. Single-section timetable grouping happens after validation; distinct linked CRN choices remain available. Course alternatives and pairwise conflicts are cached per search.

Optional sixth element of `CrawlerCourse`:

```json
{
  "status": "complete",
  "source": "https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/searchResults/getLinkedSections?term=202608",
  "bundles": [["86554", "84090"], ["86554", "84091"]]
}
```

The example is abbreviated. Each bundle includes the queried section AND all required companions. `complete` means the whole course's registration alternatives were successfully verified. An explicit no-links response establishes a singleton. Failures use `unknown` or omit metadata; they must never become singleton options. All CRNs must exist in that course's term data. Empty complete bundles mean no registration options. Old feeds remain fully usable through inferred component bundles.

The local adapter `scripts/fetch-course-data.cjs` queries every section of explicitly requested courses, parses whole option groups, and requires each member to confirm the same full bundle. It rejects login/error/empty/unrecognized responses, malformed rows, missing/cross-course CRNs, and inconsistent reciprocal links. Course failures leave unknown status and exit nonzero. Cross-course registration links require an explicit future dependency model; the adapter safely refuses them.

## Crawler changes still needed

Inspected [crawler-v2 parse.ts at e6e42db](https://github.com/gt-scheduler/crawler-v2/blob/e6e42db7567e2f9167acad8e4bb10acfb3947813/src/steps/parse.ts) and [details.ts at f230707](https://github.com/gt-scheduler/crawler-v2/blob/f2307071130c1f5454eb413ccb5791035e83d301/src/steps/details.ts). The crawler preserves AE 2610's sections and meetings, but does not retrieve or serialize authoritative linked options. Its Breakout label matches OSCAR; changing that label alone cannot repair missing registration relationships.

The crawler should fetch View Linked for every section, preserve option groups, validate reciprocal links/missing targets, and publish complete/unknown status with provenance and freshness for every course (including unlinked courses). Keep separate CRNs distinct from multiple meetings under one CRN, and preserve per-meeting schedule types currently discarded during parsing. Never turn a fetch/parse failure into a successful no-links response. This fork supports the above metadata now; the importer supplies it locally. The crawler lives in another repository and was not changed or published.

This milestone validates requested courses' registration components, not transcript prerequisites, academic eligibility, seat availability, or separate catalog corequisite courses. AE 2610 also lists AE 2611 as a catalog corequisite; confirm it through OSCAR/advising. No automatic registration or unrelated personalization was added.

## Validation and manual checks

Regression coverage includes actual AE 2610 data, all 11 choices and sorting modes, pins in both directions, exclusions, incompatible links, combined/multi-meeting sections, three-component bundles, missing data, asynchronous delivery, internal/inter-course/weekend/event conflicts, impossible schedules, response parsing, and performance bounds. Returned full schedules are checked for complete bundle membership and conflict freedom.

Run README commands, select Fall 2026, add AE 2610, and hover/select recommendations: each should include the breakout plus a 115-minute lab. Pin either component and verify the other is added. Exclude every lab and confirm zero recommendations with an explanation. Add a conflicting recurring event and verify affected options disappear. Refresh term data and confirm CRNs, links, seats, restrictions, and catalog corequisites in OSCAR before registration.

Local setup removes upstream CNAME and analytics/GTM, uses relative build paths, disables deployment/preview publishing, removes private-secret fetch scripts, and makes Firebase/Sentry opt-in. Default scheduling does not call upstream Firebase functions. Downloads stay in ignored local files.

## Recorded results

- Original-code reproduction: 12 incomplete singletons; the breakout alone ranked first.
- Live importer: AE 2610 has 11 verified reciprocal bundles; CS 1331 has 10 verified singleton bundles.
- Automated suite: 84 tests across 10 suites passed. TypeScript, ESLint, and repository-wide formatting passed. Prettier now preserves existing line endings, matching the ESLint configuration on Windows.
- Production build succeeded with 29 existing dependency source-map warnings and a large-bundle advisory. No private credentials were supplied.
- Browser check on the host development server: Fall 2026 loaded; adding AE 2610 displayed 11 choices; selecting the first pinned CRNs 86554 and 84090 and rendered both the Wednesday 12:30-13:20 breakout and Monday 15:30-17:25 lab.
- The initial sandbox server was unreachable from the host browser; an explicit host loopback server at 127.0.0.1:3001 completed the check. Initial Jest temporary-cache permission failures were resolved using the workspace cache.

## Usability correction

Published crawler data is again the default for every available course and term. No importer or environment file is needed. Verified bundles override inference. Without verification, schedule types define component roles (lecture, breakout, laboratory, studio, recitation/discussion/tutorial, common exam, and other normalized types). A combined section covers its roles with one CRN and retains all meetings. The generator selects one alternative per required role, preferring section-prefix relationships, then conflict-free same-campus choices. These are heuristics, not registration guarantees; a subtle unverified-links note tells users to confirm in OSCAR. Pins, exclusions, all meeting checks, and sorting still apply to complete bundles.

Automatic verification feasibility: the public OSCAR endpoint rejected an OPTIONS request from localhost with “Invalid CORS request”. Direct browser fetching and caching cannot reliably work without a proxy or crawler change. This milestone therefore keeps verified enrichment optional rather than adding a backend. A future crawler update can publish the existing optional bundle field; existing term-download caching will then carry that metadata automatically. No manual import is required for ordinary scheduling.

Usability follow-up validation: automated checks only; no GUI automation. Regression cases include normal lecture-only courses across 202502, 202608, and 202702, absent/unknown verification, verified precedence, inferred multi-component bundles, and inferred AE 2610.
