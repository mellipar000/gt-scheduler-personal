import fs from 'fs';
import path from 'path';

import Oscar from './Oscar';
import fixture from './__fixtures__/ae2610-202608.json';
import {
  CrawlerTermData,
  CrawlerCourse,
  CrawlerSection,
  CrawlerMeeting,
  RegistrationRequirements,
  Event,
} from '../../types';
import {
  hasConflictBetween,
  hasConflictBetweenSectionAndEvent,
  isLab,
  isLecture,
} from '../../utils/misc';
import { disableLogging } from '../../utils/tests';

const { parseLinkedSections } = jest.requireActual<{
  parseLinkedSections: (html: string) => string[][];
}>('../../../scripts/fetch-course-data.cjs');
const linkedHtml = fs.readFileSync(
  path.join(__dirname, '__fixtures__/ae2610-linked.html'),
  'utf8'
);
const source =
  'https://registration.banner.gatech.edu/StudentRegistrationSsb/ssb/searchResults/getLinkedSections?term=202608';
const event: Event = {
  id: 'event',
  name: 'Busy',
  days: ['M'],
  period: { start: 600, end: 720 },
};

function rawAE(): CrawlerTermData {
  return JSON.parse(JSON.stringify(fixture)) as CrawlerTermData;
}
function verifiedAE(): Oscar {
  const data = rawAE();
  const course = data.courses['AE 2610'] as CrawlerCourse;
  course[5] = {
    status: 'complete',
    source,
    bundles: parseLinkedSections(linkedHtml).map((companions) => [
      '86554',
      ...companions,
    ]),
  };
  return new Oscar(data, '202608');
}
function section(
  crn: string,
  type = 0,
  period = 0,
  days = 'M'
): CrawlerSection {
  return [
    crn,
    [[period, days, 'Room', 0, ['Professor'], 0, -1, -1]],
    1,
    type,
    0,
    [],
    0,
    'Test',
    [],
  ];
}
function makeCourse(
  sections: Record<string, CrawlerSection>,
  bundles: string[][]
): CrawlerCourse {
  return [
    'Test',
    sections,
    undefined,
    null,
    undefined,
    { status: 'complete', source, bundles },
  ];
}
function makeData(courses: Record<string, CrawlerCourse>): CrawlerTermData {
  return {
    courses,
    version: 3,
    updatedAt: '2026-10-31T00:00:00Z',
    caches: {
      periods: [
        '0900 - 0950',
        '1000 - 1155',
        '1300 - 1455',
        '0930 - 1030',
        'TBA',
      ],
      scheduleTypes: [
        'Lecture*',
        'Supervised Laboratory*',
        'Lecture/Lab',
        'Breakout*',
        'Recitation*',
      ],
      dateRanges: ['08/24/2026 - 12/10/2026'],
      campuses: ['Atlanta'],
      attributes: [],
      gradeBases: ['Letter'],
      locations: [],
      finalDates: [],
      finalTimes: [],
      fullCourseNames: {},
      restrictions: [],
      restrictionValues: {},
    },
  };
}
function linked(): CrawlerCourse {
  return makeCourse(
    {
      A: section('10001'),
      A1: section('10002', 1, 1),
      A2: section('10003', 1, 2),
    },
    [
      ['10001', '10002'],
      ['10001', '10003'],
    ]
  );
}
function assertValid(
  oscar: Oscar,
  desired: string[],
  pins: string[] = [],
  exclusions: string[] = [],
  events: Event[] = []
): void {
  const combinations = oscar.getCombinations(desired, pins, exclusions, events);
  expect(combinations.length).toBeGreaterThan(0);
  for (const combination of combinations) {
    const full = [...pins, ...combination.crns];
    expect(new Set(full).size).toBe(full.length);
    for (const id of desired) {
      const c = oscar.findCourse(id);
      const selected = full
        .filter((crn) => oscar.findSection(crn)?.course.id === id)
        .sort();
      expect(
        c?.registrationBundles.some(
          (b) =>
            JSON.stringify(b.map((s) => s.crn).sort()) ===
            JSON.stringify(selected)
        )
      ).toBe(true);
    }
    full.forEach((crn, i) => {
      expect(exclusions).not.toContain(crn);
      const s = oscar.findSection(crn);
      expect(s).toBeDefined();
      if (!s) return;
      expect(events.some((e) => hasConflictBetweenSectionAndEvent(s, e))).toBe(
        false
      );
      full.slice(0, i).forEach((other) => {
        const t = oscar.findSection(other);
        if (t) expect(hasConflictBetween(s, t)).toBe(false);
      });
    });
  }
}

beforeEach(disableLogging);

describe('AE 2610, captured Fall 2026 crawler data and OSCAR links', () => {
  it('detects the Breakout classification and retains 50/115 minute meetings', () => {
    const oscar = verifiedAE();
    const anchor = oscar.findSection('86554');
    const lab = oscar.findSection('84090');
    expect(anchor?.scheduleType).toBe('Breakout*');
    expect(anchor && isLecture(anchor)).toBe(true);
    expect(lab && isLab(lab)).toBe(true);
    expect(anchor && anchor.meetings[0] && anchor.meetings[0].period).toEqual({
      start: 750,
      end: 800,
    });
    expect(lab && lab.meetings[0] && lab.meetings[0].period).toEqual({
      start: 930,
      end: 1045,
    });
  });
  it('refuses lecture-only or lab-only recommendations from unverified published data', () => {
    const result = new Oscar(rawAE(), '202608').getCombinationResult(
      ['AE 2610'],
      [],
      [],
      []
    );
    expect(result.combinations).toEqual([]);
    expect(result.diagnostics.join()).toMatch(
      /Verified registration requirements/
    );
  });
  it('returns all 11 verified lab choices, each with the mandatory breakout, for every sort', () => {
    const oscar = verifiedAE();
    const combinations = oscar.getCombinations(['AE 2610'], [], [], []);
    expect(combinations).toHaveLength(11);
    oscar.sortingOptions.forEach((_, index) => {
      const sorted = oscar.sortCombinations(combinations, index, []);
      expect(sorted.map((c) => [...c.crns].sort()).sort()).toEqual(
        combinations.map((c) => [...c.crns].sort()).sort()
      );
      sorted.forEach((c) => {
        expect(c.crns).toContain('86554');
        expect(c.crns).toHaveLength(2);
      });
    });
    assertValid(oscar, ['AE 2610']);
  });
  it.each([['86554'], ['84090'], ['86554', '84090']])(
    'completes pinned components %j',
    (...pins) => {
      assertValid(verifiedAE(), ['AE 2610'], pins);
    }
  );
});

describe('complete registration generation', () => {
  it('supports multiple lab choices and both pin directions', () => {
    const oscar = new Oscar(makeData({ 'TEST 1000': linked() }), '202608');
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])).toHaveLength(2);
    assertValid(oscar, ['TEST 1000'], ['10001']);
    assertValid(oscar, ['TEST 1000'], ['10002']);
    assertValid(oscar, ['TEST 1000'], [], ['10002']);
  });
  it('supports combined sections with multiple meetings under one CRN', () => {
    const combined = section('10001', 2);
    combined[1].push([1, 'T', 'Lab', 0, [], 0, -1, -1]);
    const oscar = new Oscar(
      makeData({ 'TEST 1000': makeCourse({ A: combined }, [['10001']]) }),
      '202608'
    );
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])[0]?.crns).toEqual([
      '10001',
    ]);
    expect(oscar.findSection('10001')?.meetings).toHaveLength(2);
    assertValid(oscar, ['TEST 1000']);
    expect(
      oscar.getCombinations(['TEST 1000'], [], [], [{ ...event, days: ['T'] }])
    ).toEqual([]);
  });
  it('supports more than two required registration CRNs', () => {
    const c = linked();
    c[1]['R'] = section('10004', 4, 2, 'T');
    c[5] = {
      status: 'complete',
      source,
      bundles: [['10001', '10002', '10004']],
    };
    assertValid(new Oscar(makeData({ 'TEST 1000': c }), '202608'), [
      'TEST 1000',
    ]);
  });
  it.each([
    { pins: ['10001'], excluded: ['10001'] },
    { pins: [], excluded: ['10001'] },
    { pins: [], excluded: ['10002', '10003'] },
    { pins: ['10002', '10003'], excluded: [] },
    { pins: ['99999'], excluded: [] },
  ])('rejects impossible pins/exclusions: %j', ({ pins, excluded }) => {
    const oscar = new Oscar(makeData({ 'TEST 1000': linked() }), '202608');
    const result = oscar.getCombinationResult(
      ['TEST 1000'],
      pins,
      excluded,
      []
    );
    expect(result.combinations).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
  it('rejects incompatible pinned links even when their times do not overlap', () => {
    const c = linked();
    c[1]['B'] = section('10004', 0, 0, 'T');
    c[5]?.bundles.push(['10004', '10003']);
    expect(
      new Oscar(makeData({ 'TEST 1000': c }), '202608').getCombinations(
        ['TEST 1000'],
        ['10004', '10002'],
        [],
        []
      )
    ).toEqual([]);
  });
  it('never invents links from names or instructors', () => {
    const c = linked();
    c[5] = undefined;
    expect(
      new Oscar(makeData({ 'TEST 1000': c }), '202608').getCombinations(
        ['TEST 1000'],
        [],
        [],
        []
      )
    ).toEqual([]);
  });
  it('checks conflicts within a linked bundle, including when both CRNs are pinned', () => {
    const c = makeCourse({ A: section('10001'), A1: section('10002', 1, 3) }, [
      ['10001', '10002'],
    ]);
    const oscar = new Oscar(makeData({ 'TEST 1000': c }), '202608');
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])).toEqual([]);
    expect(
      oscar.getCombinations(['TEST 1000'], ['10001', '10002'], [], [])
    ).toEqual([]);
  });
  it('does not skip an impossible course while recommending the others', () => {
    const oscar = new Oscar(
      makeData({ 'TEST 1000': makeCourse({}, []), 'TEST 2000': linked() }),
      '202608'
    );
    expect(
      oscar.getCombinations(['TEST 1000', 'TEST 2000'], [], [], [])
    ).toEqual([]);
  });
  it('checks recurring events against pinned and generated components', () => {
    const oscar = new Oscar(makeData({ 'TEST 1000': linked() }), '202608');
    assertValid(oscar, ['TEST 1000'], [], [], [event]);
    expect(
      oscar.getCombinations(['TEST 1000'], ['10002'], [], [event])
    ).toEqual([]);
  });
  it('checks weekend conflicts too', () => {
    const oscar = new Oscar(
      makeData({
        'TEST 1000': makeCourse({ A: section('10001', 0, 0, 'S') }, [
          ['10001'],
        ]),
      }),
      '202608'
    );
    expect(
      oscar.getCombinations(
        ['TEST 1000'],
        [],
        [],
        [{ ...event, days: ['S'], period: { start: 540, end: 600 } }]
      )
    ).toEqual([]);
  });
  it('reports conflicts across courses without dropping either course', () => {
    const oscar = new Oscar(
      makeData({
        'TEST 1000': linked(),
        'TEST 2000': makeCourse({ A: section('20001', 0, 3) }, [['20001']]),
      }),
      '202608'
    );
    const result = oscar.getCombinationResult(
      ['TEST 1000', 'TEST 2000'],
      [],
      [],
      []
    );
    expect(result.combinations).toEqual([]);
    expect(result.diagnostics.join()).toMatch(/time conflict/);
  });
  it.each(['course', 'link', 'time', 'date', 'type', 'empty options'])(
    'reports missing %s data',
    (missing) => {
      const d = makeData({ 'TEST 1000': linked() });
      const c = d.courses['TEST 1000'] as CrawlerCourse;
      if (missing === 'course') delete d.courses['TEST 1000'];
      if (missing === 'link') c[5]?.bundles.push(['99999']);
      if (missing === 'time')
        Object.values(c[1]).forEach((s) => {
          (s[1][0] as CrawlerMeeting)[0] = 4;
        });
      if (missing === 'date') d.caches.dateRanges = [];
      if (missing === 'type') d.caches.scheduleTypes = [];
      if (missing === 'empty options')
        (c[5] as RegistrationRequirements).bundles = [];
      const result = new Oscar(d, '202608').getCombinationResult(
        ['TEST 1000'],
        [],
        [],
        []
      );
      expect(result.combinations).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  );
  it('checks all meetings and retains a valid alternative when another has missing data', () => {
    const c = linked();
    ((c[1]['A1'] as CrawlerSection)[1][0] as CrawlerMeeting)[0] = 4;
    const oscar = new Oscar(makeData({ 'TEST 1000': c }), '202608');
    const result = oscar.getCombinationResult(['TEST 1000'], [], [], []);
    expect(result.combinations).toHaveLength(1);
    expect(result.diagnostics.join()).toMatch(/missing meeting/);
    assertValid(oscar, ['TEST 1000']);
  });
  it('preserves timetable deduplication after exclusions and accepts an empty request', () => {
    const c = makeCourse({ A: section('10001'), B: section('10002') }, [
      ['10001'],
      ['10002'],
    ]);
    const oscar = new Oscar(makeData({ 'TEST 1000': c }), '202608');
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])).toHaveLength(1);
    expect(
      oscar.getCombinations(['TEST 1000'], [], ['10001'], [])[0]?.crns
    ).toEqual(['10002']);
    expect(oscar.getCombinations([], [], [], [])).toHaveLength(1);
  });
  it('retains distinct linked CRN choices with identical meeting times', () => {
    const c = linked();
    const [, meetings] = c[1]['A1'] as CrawlerSection;
    (c[1]['A2'] as CrawlerSection)[1] = meetings;
    const oscar = new Oscar(makeData({ 'TEST 1000': c }), '202608');
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])).toHaveLength(2);
    assertValid(oscar, ['TEST 1000']);
  });
  it('rejects stale exclusions and invalid or conflicting recurring events', () => {
    const oscar = new Oscar(makeData({ 'TEST 1000': linked() }), '202608');
    expect(oscar.getCombinations(['TEST 1000'], [], ['99999'], [])).toEqual([]);
    expect(
      oscar.getCombinations(['TEST 1000'], [], [], [event, event])
    ).toEqual([]);
    expect(
      oscar.getCombinations(['TEST 1000'], [], [], [{ ...event, days: [] }])
    ).toEqual([]);
  });
  it('allows explicitly asynchronous sections without scheduled meetings', () => {
    const c = makeCourse({ A: section('10001') }, [['10001']]);
    const raw = c[1]['A'] as CrawlerSection;
    raw[1] = [];
    raw[5] = [0];
    const d = makeData({ 'TEST 1000': c });
    d.caches.attributes = ['Remote Asynchronous Course'];
    assertValid(new Oscar(d, '202608'), ['TEST 1000']);
  });
  it('checks conflicts between multiple meetings within one section', () => {
    const raw = section('10001');
    raw[1].push([3, 'M', 'Room', 0, [], 0, -1, -1]);
    const oscar = new Oscar(
      makeData({ 'TEST 1000': makeCourse({ A: raw }, [['10001']]) }),
      '202608'
    );
    expect(oscar.getCombinations(['TEST 1000'], [], [], [])).toEqual([]);
  });
  it('enumerates 4096 valid schedules within a generous performance bound', () => {
    const courses: Record<string, CrawlerCourse> = {};
    for (let i = 0; i < 6; i++) {
      const sections: Record<string, CrawlerSection> = {};
      const bundles: string[][] = [];
      ['M', 'T', 'W', 'R'].forEach((day, j) => {
        const crn = `${i}000${j}`;
        sections[day] = section(crn, 0, i, day);
        bundles.push([crn]);
      });
      courses[`TEST ${i}`] = makeCourse(sections, bundles);
    }
    const d = makeData(courses);
    d.caches.periods = Array.from(
      { length: 6 },
      (_, i) => `${i + 8}00 - ${i + 8}50`
    );
    const oscar = new Oscar(d, '202608');
    const start = performance.now();
    expect(
      oscar.getCombinations(Object.keys(courses), [], [], [])
    ).toHaveLength(4096);
    expect(performance.now() - start).toBeLessThan(2000);
  });
  it('handles a representative search without a combinatorial performance regression', () => {
    const courses: Record<string, CrawlerCourse> = {};
    for (let i = 0; i < 8; i++) {
      courses[`TEST ${i}`] = makeCourse(
        {
          A: section(`${i}0001`, 0, 0, i % 2 ? 'T' : 'M'),
          B: section(`${i}0002`, 0, 2, i % 2 ? 'R' : 'W'),
        },
        [[`${i}0001`], [`${i}0002`]]
      );
    }
    const oscar = new Oscar(makeData(courses), '202608');
    const start = performance.now();
    expect(oscar.getCombinations(Object.keys(courses), [], [], [])).toEqual([]);
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe('authoritative linked-section response parser', () => {
  it('reads the actual 11 OSCAR alternatives', () => {
    expect(parseLinkedSections(linkedHtml)).toHaveLength(11);
  });
  it('distinguishes an explicit no-links response from missing data', () => {
    expect(
      parseLinkedSections(
        '<section aria-labelledby="linked">No linked course information available.</section>'
      )
    ).toEqual([[]]);
    [
      '',
      '<html>Sign in</html>',
      '<section aria-labelledby="linked"></section>',
      linkedHtml.replace('84090', 'TBA'),
    ].forEach((html) => expect(() => parseLinkedSections(html)).toThrow());
  });
});
