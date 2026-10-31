import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { run } from './cli';
import Oscar from '../data/beans/Oscar';
import fixture from '../data/beans/__fixtures__/ae2610-202608.json';
import { CrawlerTermData, CrawlerCourse, CrawlerSection } from '../types';
import { ScheduleTransfer, validateTransfer } from '../data/scheduleTransfer';

const dataFile = path.resolve('src/data/beans/__fixtures__/ae2610-202608.json');
const base = { op: 'search', term: '202608', dataFile, courses: ['AE 2610'] };
type Search = {
  total: number;
  candidates: { crns: string[]; preferencePenalty: number }[];
  diagnostics: string[];
};
const search = (overrides: object = {}): Search =>
  run({ ...base, ...overrides }) as Search;
const directory = path.resolve('.local-data/harness-tests');
beforeAll(() => fs.mkdirSync(directory, { recursive: true }));

it('matches the application engine, includes linked components and returns only five candidates', () => {
  const oscar = new Oscar(fixture as unknown as CrawlerTermData, '202608');
  const ranked = oscar.sortCombinations(
    oscar.getCombinations(['AE 2610'], [], [], []),
    6,
    []
  );
  const result = search();
  expect(result.total).toBe(ranked.length);
  expect(result.candidates.map((c) => c.crns)).toEqual(
    ranked.slice(0, 5).map((c) => c.scheduledCrns)
  );
  expect(result.candidates.every((c) => c.crns.length === 2)).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(2500);
  expect(search()).toEqual(result);
});

it('enforces hard Friday/time/event constraints and ranks soft labs without removing alternatives', () => {
  const oscar = new Oscar(fixture as unknown as CrawlerTermData, '202608');
  const result = search({ hard: { avoidDays: ['F'] }, topK: 50 });
  result.candidates.forEach((c) =>
    c.crns.forEach((crn) => {
      expect(
        oscar.findSection(crn)?.meetings.some((m) => m.days.includes('F'))
      ).toBe(false);
    })
  );
  expect(search({ hard: { earliestStart: 1439 } }).total).toBe(0);
  expect(
    search({
      hard: {
        events: [
          {
            id: 'busy',
            name: 'Busy',
            days: ['M', 'T', 'W', 'R', 'F'],
            period: { start: 1, end: 1440 },
          },
        ],
      },
    }).total
  ).toBe(0);
  const preferred = search().candidates[4]!.crns[1]!;
  const soft = search({ soft: { preferCrns: [preferred], sort: 5 } });
  expect(soft.total).toBe(search().total);
  expect(soft.candidates[0]?.crns).toContain(preferred);
});

it('reports infeasibility, validates strict inputs and pages inspection', () => {
  expect(
    search({ hard: { pinnedCrns: ['missing'] } }).diagnostics.join()
  ).toMatch(/missing/);
  expect(
    search({
      hard: { avoidDays: ['M', 'T', 'W', 'R', 'F'] },
    }).diagnostics.join()
  ).toMatch(/No complete/);
  expect(() => search({ topK: 1000 })).toThrow();
  expect(() => search({ hard: { avoidFriday: true } })).toThrow();
  const page = run({ ...base, op: 'sections', course: 'AE 2610', topK: 2 }) as {
    items: unknown[];
    nextOffset: number;
  };
  expect(page.items).toHaveLength(2);
  expect(page.nextOffset).toBe(2);
});

it('exports complete candidates, rejects incomplete and cross-term imports, and preserves source preferences', () => {
  const { crns } = search().candidates[0]!;
  const transfer = run({ ...base, op: 'export', crns }) as ScheduleTransfer;
  expect(transfer.schedule.pinnedCrns).toEqual(crns);
  expect(() =>
    run({ ...base, op: 'export', crns, hard: { pinnedCrns: ['87855'] } })
  ).toThrow(/required pinned/);
  expect(() =>
    run({
      ...base,
      op: 'export',
      crns,
      hard: { avoidDays: ['M', 'T', 'W', 'R', 'F'] },
    })
  ).toThrow();
  expect(() => run({ ...base, op: 'export', crns: crns.slice(0, 1) })).toThrow(
    /every CRN/
  );
  expect(() =>
    validateTransfer(
      { ...transfer, term: '202708' },
      new Oscar(fixture as unknown as CrawlerTermData, '202608')
    )
  ).toThrow(/term/);
  const file = path.join(directory, 'version.json');
  fs.writeFileSync(file, JSON.stringify(transfer));
  expect(run({ op: 'read', term: '202608', scheduleFile: file })).toEqual({
    schedule: transfer.schedule,
  });
});

it('uses the real JSON process, defaults to dry-run and backs up confirmed append-only writes', () => {
  const transfer = run({
    ...base,
    op: 'export',
    crns: search().candidates[0]!.crns,
  }) as ScheduleTransfer;
  const versionFile = path.join(directory, 'import.json');
  const storeFile = path.join(directory, 'store.json');
  const store = {
    version: 3,
    terms: {
      '202608': {
        versions: {
          original: {
            name: 'Keep me',
            friends: {},
            createdAt: '2026-10-31T00:00:00.000Z',
            schedule: transfer.schedule,
          },
        },
      },
    },
  };
  fs.writeFileSync(versionFile, JSON.stringify(transfer));
  const original = JSON.stringify(store);
  fs.writeFileSync(storeFile, original);
  const input = JSON.stringify({
    ...base,
    op: 'import',
    scheduleFile: versionFile,
    storeFile,
  });
  const cli = (
    ...args: string[]
  ): { ok: boolean; backup: string; dryRun: boolean } => {
    const result = spawnSync(
      process.execPath,
      ['scripts/scheduler.cjs', ...args],
      { input, encoding: 'utf8', timeout: 20000 }
    );
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout) as {
      ok: boolean;
      backup: string;
      dryRun: boolean;
    };
  };
  expect(cli('--output', storeFile).dryRun).toBe(true);
  expect(fs.readFileSync(storeFile, 'utf8')).toBe(original);
  const confirmed = cli('--output', storeFile, '--confirm-write');
  expect(fs.readFileSync(confirmed.backup, 'utf8')).toBe(original);
  const updated = JSON.parse(
    fs.readFileSync(storeFile, 'utf8')
  ) as typeof store;
  expect(updated.terms['202608'].versions.original).toEqual(
    store.terms['202608'].versions.original
  );
  expect(Object.keys(updated.terms['202608'].versions)).toHaveLength(2);
}, 30000);

it('bounds the shared engine search instead of returning a misleading partial ranking', () => {
  const oscar = new Oscar(fixture as unknown as CrawlerTermData, '202608');
  expect(() =>
    oscar.getCombinationResult(['AE 2610'], [], [], [], {
      maxCombinations: 1,
      maxNodes: 1000,
    })
  ).toThrow(/limit/);
  expect(() =>
    oscar.getCombinationResult(['AE 2610'], [], [], [], {
      maxCombinations: 1000,
      maxNodes: 1,
    })
  ).toThrow(/limit/);
});

it('checks local search latency and bounded serialized output', () => {
  const start = performance.now();
  for (let i = 0; i < 30; i++) expect(search().candidates).toHaveLength(5);
  const milliseconds = performance.now() - start;
  expect(milliseconds).toBeLessThan(10000);
  expect(JSON.stringify(search()).length).toBeLessThan(2500);
});

it('ranks 4096 real engine combinations while returning five compact summaries', () => {
  const data = JSON.parse(JSON.stringify(fixture)) as CrawlerTermData;
  data.courses = {};
  data.caches.periods = Array.from(
    { length: 6 },
    (_, i) => `${900 + i * 100} - ${950 + i * 100}`
  );
  for (let c = 0; c < 6; c++) {
    const entries: Record<string, CrawlerSection> = {};
    for (let s = 0; s < 4; s++)
      entries[`A${s}`] = [
        `${10000 + c * 10 + s}`,
        [[c, 'M', 'Room', 0, ['Professor'], 0, -1, -1]],
        1,
        0,
        0,
        [],
        0,
        'Test',
        [],
      ];
    const course: CrawlerCourse = [
      'Test',
      entries,
      undefined,
      null,
      undefined,
      {
        status: 'complete',
        source: 'deterministic-test',
        bundles: Object.values(entries).map((s) => [s[0]]),
      },
    ];
    data.courses[`TEST ${1000 + c}`] = course;
  }
  const file = path.join(directory, 'performance.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const start = performance.now();
  const result = search({ dataFile: file, courses: Object.keys(data.courses) });
  const elapsed = performance.now() - start;
  expect(result.total).toBe(4096);
  expect(result.candidates).toHaveLength(5);
  expect(JSON.stringify(result).length).toBeLessThan(4000);
  expect(elapsed).toBeLessThan(10000);
  // Visible benchmark numbers only when explicitly requested.
  if (process.env['SCHEDULER_BENCHMARK'])
    process.stdout.write(
      `${JSON.stringify({ elapsed, bytes: JSON.stringify(result).length })}\n`
    );
});
