import type Course from '../data/beans/Course';
import type Section from '../data/beans/Section';
import { courseCredits, formatCredits, totalCourseCredits } from './credits';
import professorSearchUrl from './professorSearch';

function makeCourse(bundles: Array<Array<[string, number]>>): Course {
  const sections = new Map<string, Section>();
  const registrationBundles = bundles.map((bundle) =>
    bundle.map(([crn, credits]) => {
      if (!sections.has(crn)) sections.set(crn, { crn, credits } as Section);
      return sections.get(crn) as Section;
    })
  );
  return {
    sections: Array.from(sections.values()),
    registrationBundles,
    prepareRegistrationBundles: jest.fn(),
  } as unknown as Course;
}

it('counts unpinned complete lecture and lab bundles once, and narrows with pins and exclusions', () => {
  const course = makeCourse([
    [
      ['lecture', 3],
      ['lab', 0],
    ],
    [
      ['other', 4],
      ['otherLab', 0],
    ],
  ]);
  expect(formatCredits(courseCredits(course))).toBe('3–4');
  expect(formatCredits(courseCredits(course, ['lab']))).toBe('3');
  expect(formatCredits(courseCredits(course, [], ['lecture']))).toBe('4');
  expect(courseCredits(course, ['lecture', 'other'])).toBeNull();
});

it('does not guess when component credits or missing values are ambiguous', () => {
  expect(
    courseCredits(
      makeCourse([
        [
          ['lecture', 3],
          ['lab', 3],
        ],
      ])
    )
  ).toBeNull();
  expect(courseCredits(makeCourse([[['only', 0]]]))).toBeNull();
  expect(courseCredits(makeCourse([[['only', NaN]]]))).toBeNull();
  expect(courseCredits(undefined)).toBeNull();
});

it('adds ranges without treating unresolved courses as zero', () => {
  expect(
    formatCredits(
      totalCourseCredits([
        { min: 3, max: 4 },
        { min: 2, max: 2 },
      ])
    )
  ).toBe('5–6');
  expect(formatCredits(totalCourseCredits([{ min: 3, max: 3 }, null]))).toBe(
    'Unresolved'
  );
  expect(formatCredits(totalCourseCredits([]))).toBe('0');
});

it('links by full instructor name to Georgia Tech search and omits placeholders', () => {
  expect(professorSearchUrl('Ada Lovelace')).toBe(
    'https://www.ratemyprofessors.com/search/professors/361?q=Ada%20Lovelace'
  );
  expect(professorSearchUrl('TBA')).toBeNull();
  expect(professorSearchUrl('Not Assigned')).toBeNull();
});
