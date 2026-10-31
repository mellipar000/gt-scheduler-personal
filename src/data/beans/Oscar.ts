import { Immutable } from 'immer';
import { decode } from 'html-entities';
import axios from 'axios';

import Course from './Course';
import Section from './Section';
import SortingOption from './SortingOption';
import {
  hasConflictBetween,
  hasConflictBetweenSectionAndEvent,
  hasConflictBetweenMeetings,
  stringToTime,
} from '../../utils/misc';
import {
  Combination,
  CombinationResult,
  Period,
  DateRange,
  Location,
  CrawlerTermData,
  Event,
  Meeting,
} from '../../types';
import { ErrorWithFields, softError } from '../../log';
import { CLOUD_FUNCTION_BASE_URL } from '../../constants';
import { PlannedCountsData } from '../types';
import { getTravel } from '../../utils/mapbox/misc';

const PLANNED_COUNTS_API_URL = `${CLOUD_FUNCTION_BASE_URL}/getPlannedCounts`;

// `new Oscar(...)` gets the entirety of the crawler JSON data
type OscarConstructionDate = CrawlerTermData;

export default class Oscar {
  periods: (Period | undefined)[];

  dateRanges: DateRange[];

  finalDates: Date[];

  finalTimes: (Period | null)[];

  scheduleTypes: string[];

  campuses: string[];

  attributes: string[];

  gradeBases: string[];

  locations: (Location | null)[];

  restrictions: string[];

  restrictionValues: Record<string, string[]>;

  updatedAt: Date;

  version: number;

  courses: Course[];

  courseMap: Record<string, Course>;

  crnMap: Record<string, Section>;

  sortingOptions: SortingOption[];

  plannedCounts: PlannedCountsData | undefined;

  constructor(
    data: OscarConstructionDate,
    public term: string,
    plannedCounts?: PlannedCountsData
  ) {
    this.plannedCounts = plannedCounts;
    const { courses, caches, updatedAt, version } = data;

    this.periods = caches.periods.map((period, i) => {
      if (period === 'TBA') {
        return undefined;
      }

      const periodSegments = period.split(' - ');
      if (
        periodSegments.length !== 2 ||
        periodSegments.some(
          (value) =>
            !/^\d{3,4}$/.test(value) ||
            Number(value.slice(-2)) > 59 ||
            Number(value.slice(0, -2)) > 23
        )
      ) {
        softError(
          new ErrorWithFields({
            message: 'period did not follow expected format',
            fields: {
              period,
              cacheIndex: i,
              term: this.term,
            },
          })
        );
        return undefined;
      }

      const [start, end] = periodSegments as [string, string];
      return {
        start: stringToTime(start),
        end: stringToTime(end),
      };
    });

    this.finalTimes =
      caches.finalTimes === undefined
        ? []
        : caches.finalTimes.map((finalTime, i) => {
            if (finalTime === 'TBA') return null;
            const finalSegments = finalTime.split(' - ');
            if (finalSegments.length !== 2) {
              softError(
                new ErrorWithFields({
                  message: 'finalTime did not follow expected format',
                  fields: {
                    finalTime,
                    cacheIndex: i,
                    term: this.term,
                  },
                })
              );
              return null;
            }

            const [start, end] = finalSegments as [string, string];
            return {
              start: stringToTime(start),
              end: stringToTime(end),
            };
          });

    this.dateRanges = caches.dateRanges.map((dateRange, i) => {
      let segments = dateRange.split(' - ');
      if (segments.length !== 2) {
        softError(
          new ErrorWithFields({
            message: 'date range did not follow expected format',
            fields: {
              dateRange,
              cacheIndex: i,
              term: this.term,
            },
          })
        );
        // We need some fallback here
        segments = ['', ''];
      }

      const [from, to] = segments.map((v) => new Date(v)) as [Date, Date];
      from.setHours(0);
      to.setHours(23, 59, 59, 999);
      return { from, to };
    });

    this.finalDates =
      caches.finalDates === undefined
        ? []
        : caches.finalDates?.map((date) => {
            return new Date(date);
          });

    this.scheduleTypes = caches.scheduleTypes;
    this.campuses = caches.campuses.map((campus: string) => decode(campus));
    this.attributes = caches.attributes;
    this.gradeBases = caches.gradeBases;
    this.locations = caches.locations;
    this.restrictions = caches.restrictions || [];
    this.restrictionValues = caches.restrictionValues || {};
    this.updatedAt = new Date(updatedAt);
    this.version = version;

    this.courses = Object.entries(courses).flatMap(([courseId, source]) => {
      try {
        return [new Course(this, courseId, source)];
      } catch (err) {
        softError(
          new ErrorWithFields({
            message: 'could not initialize Course bean',
            fields: {
              courseId,
              source,
              term: this.term,
            },
          })
        );
        return [];
      }
    });

    this.courseMap = {};
    this.crnMap = {};
    this.courses.forEach((course) => {
      this.courseMap[course.id] = course;
      course.sections.forEach((section) => {
        this.crnMap[section.crn] = section;
      });
    });

    this.sortingOptions = [
      new SortingOption('Most Compact', (combination, events) => {
        const { startMap, endMap } = combination;

        const eventStartMap = new Map<string, number>();
        const eventEndMap = new Map<string, number>();
        events.forEach((event) => {
          const { start, end } = event.period;
          for (const day of event.days) {
            if (!eventStartMap.has(day)) {
              eventStartMap.set(day, start);
            }
            eventStartMap.set(
              day,
              Math.min(start, eventStartMap.get(day) ?? Infinity)
            );

            if (!eventEndMap.has(day)) {
              eventEndMap.set(day, end);
            }
            eventEndMap.set(day, Math.max(end, eventEndMap.get(day) ?? -1));
          }
        });
        const diffs = Object.keys(startMap).map((day) => {
          let end = endMap[day];
          let start = startMap[day];
          if (end == null || start == null) return 0;
          end = Math.max(end, eventEndMap.get(day) ?? -1);
          start = Math.min(start, eventStartMap.get(day) ?? Infinity);

          return end - start;
        });
        const sum = diffs.reduce((tot, min) => tot + min, 0);
        return +sum;
      }),
      new SortingOption('Earliest Ending', (combination) => {
        const { endMap } = combination;
        const ends = Object.values(endMap);
        const sum = ends.reduce<number>((tot, end) => tot + (end ?? 0), 0);
        const avg = sum / ends.length;
        return +avg;
      }),
      new SortingOption('Latest Beginning', (combination) => {
        const { startMap } = combination;
        const starts = Object.values(startMap);
        const sum = starts.reduce<number>((tot, min) => tot + (min ?? 0), 0);
        const avg = sum / starts.length;
        return -avg;
      }),
      new SortingOption('Least Travel Time', (combination) => {
        let total = 0;
        for (let c = 0; c < combination.crns.length - 1; c++) {
          const crnA = combination.crns[c];
          const crnB = combination.crns[c + 1];

          if (crnA && crnB) {
            const sectionA = this.findSection(crnA);
            const sectionB = this.findSection(crnB);

            if (sectionA && sectionB) {
              const locA = sectionA.meetings[0]?.location ?? null;
              const locB = sectionB.meetings[0]?.location ?? null;

              total += getTravel(locA, locB);
            }
          }
        }
        return total;
      }),
    ];
  }

  static async create(
    data: OscarConstructionDate,
    term: string
  ): Promise<Oscar> {
    if (!CLOUD_FUNCTION_BASE_URL) return new Oscar(data, term);
    const url = `${PLANNED_COUNTS_API_URL}?term=${term}`;
    let plannedCounts: PlannedCountsData | undefined;
    try {
      plannedCounts = (await axios.get<PlannedCountsData>(url)).data;
    } catch (err) {
      softError(
        new ErrorWithFields({
          message: 'could not retrieve plannedCounts',
          fields: {
            term,
          },
        })
      );
      return new Oscar(data, term);
    }

    return new Oscar(data, term, plannedCounts);
  }

  findCourse(courseId: string): Course | undefined {
    return this.courseMap[courseId];
  }

  findSection(crn: string): Section | undefined {
    return this.crnMap[crn];
  }

  getCombinations(
    desiredCourses: readonly string[],
    pinnedCrns: readonly string[],
    excludedCrns: readonly string[],
    events: Immutable<Event[]>
  ): Combination[] {
    return this.getCombinationResult(
      desiredCourses,
      pinnedCrns,
      excludedCrns,
      events
    ).combinations;
  }

  getCombinationResult(
    desiredCourses: readonly string[],
    pinnedCrns: readonly string[],
    excludedCrns: readonly string[],
    events: Immutable<Event[]>
  ): CombinationResult {
    const diagnostics: string[] = [];
    const fail = (message: string): CombinationResult => ({
      combinations: [],
      diagnostics: [message],
    });
    const pinned = new Set(pinnedCrns);
    const excluded = new Set(excludedCrns);
    const courseIds = Array.from(new Set(desiredCourses));
    const pinnedSections: Section[] = [];
    for (const crn of excludedCrns) {
      if (!this.findSection(crn))
        return fail(
          `Excluded CRN ${crn} is missing from the course data. Refresh or clear the stale exclusion.`
        );
    }
    for (const [index, event] of Array.from(events.entries())) {
      if (
        !event.days.length ||
        event.days.some((day) => !'MTWRFSU'.includes(day)) ||
        !Number.isFinite(event.period.start) ||
        !Number.isFinite(event.period.end) ||
        event.period.start < 0 ||
        event.period.end > 1440 ||
        event.period.start >= event.period.end
      ) {
        return fail(
          `Recurring event "${event.name}" has missing or invalid days or times.`
        );
      }
      if (
        events
          .slice(0, index)
          .some((other) => hasConflictBetweenMeetings(event, other))
      ) {
        return fail(
          `Recurring event "${event.name}" conflicts with another recurring event.`
        );
      }
    }
    for (const crn of Array.from(pinned)) {
      const section = this.findSection(crn);
      if (!section)
        return fail(`Pinned CRN ${crn} is missing from the course data.`);
      if (excluded.has(crn))
        return fail(`CRN ${crn} is both pinned and excluded.`);
      if (!courseIds.includes(section.course.id)) {
        return fail(
          `Pinned CRN ${crn} belongs to ${section.course.id}, which is not requested.`
        );
      }
      if (section.schedulingIssue)
        return fail(
          `${section.course.id} (${crn}): ${section.schedulingIssue}`
        );
      if (
        pinnedSections.some((other) => hasConflictBetween(other, section)) ||
        events.some((event) =>
          hasConflictBetweenSectionAndEvent(section, event)
        )
      ) {
        return fail(
          `Pinned CRN ${crn} conflicts with another pinned section or recurring event.`
        );
      }
      pinnedSections.push(section);
    }

    // Build and validate each course's alternatives once, outside the search.
    const choices: Section[][][] = [];
    for (const courseId of courseIds) {
      const course = this.findCourse(courseId);
      if (!course)
        return fail(
          `${courseId}: Course data is missing or could not be read.`
        );
      if (course.registrationIssue)
        return fail(`${courseId}: ${course.registrationIssue}`);
      const requiredPins = pinnedSections.filter((s) => s.course === course);
      let missingTimes = false;
      const candidates = course.registrationBundles.filter((bundle) => {
        if (
          bundle.some((s) => excluded.has(s.crn)) ||
          requiredPins.some((s) => !bundle.includes(s))
        )
          return false;
        if (bundle.some((s) => s.schedulingIssue)) {
          missingTimes = true;
          return false;
        }
        return !bundle.some(
          (section, i) =>
            bundle
              .slice(0, i)
              .some((other) => hasConflictBetween(other, section)) ||
            pinnedSections.some(
              (other) => other !== section && hasConflictBetween(other, section)
            ) ||
            events.some((event) =>
              hasConflictBetweenSectionAndEvent(section, event)
            )
        );
      });
      if (missingTimes)
        diagnostics.push(
          `${courseId}: Sections with missing meeting data were rejected; their time conflicts cannot be checked.`
        );
      if (!candidates.length) {
        return {
          combinations: [],
          diagnostics: [
            ...diagnostics,
            `${courseId}: No complete registration option satisfies the pinned sections, exclusions, linked-section requirements, and time constraints.`,
          ],
        };
      }
      // Preserve one representative per equivalent timetable, but only AFTER
      // checking pins, exclusions, dates and every component in each bundle.
      const seen = new Set<string>();
      choices.push(
        candidates
          .filter((bundle) => {
            if (bundle.length > 1) return true;
            const key = JSON.stringify(
              bundle.flatMap((s) =>
                s.meetings.map(({ days, period, dateRange }) => ({
                  days,
                  period,
                  dateRange,
                }))
              )
            );
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map((bundle) => bundle.filter((s) => !pinned.has(s.crn)))
      );
    }

    const crnsList: string[][] = [];
    const conflicts = new Map<string, boolean>();
    const conflict = (a: Section, b: Section): boolean => {
      const key = [a.crn, b.crn].sort().join(',');
      let value = conflicts.get(key);
      if (value === undefined) {
        value = hasConflictBetween(a, b);
        conflicts.set(key, value);
      }
      return value;
    };
    const dfs = (courseIndex: number, selected: Section[]): void => {
      if (courseIndex === choices.length) {
        crnsList.push(selected.map((s) => s.crn));
        return;
      }
      for (const bundle of choices[courseIndex] ?? []) {
        if (!bundle.some((s) => selected.some((other) => conflict(s, other)))) {
          dfs(courseIndex + 1, [...selected, ...bundle]);
        }
      }
    };
    dfs(0, []);
    if (!crnsList.length)
      diagnostics.push(
        `No complete schedule exists for ${courseIds.join(
          ', '
        )}: every remaining registration combination has a time conflict. Try different pins, exclusions, or recurring events.`
      );
    const combinations = crnsList.map((crns) => {
      const startMap: Record<string, number> = {};
      const endMap: Record<string, number> = {};
      this.iterateTimeBlocks(
        [...pinnedCrns, ...crns],
        events,
        (day, period) => {
          if (period === undefined) return;
          const end = endMap[day];
          const start = startMap[day];
          if (start == null || start > period.start)
            startMap[day] = period.start;
          if (end == null || end < period.end) endMap[day] = period.end;
        }
      );
      return {
        crns,
        startMap,
        endMap,
      };
    });
    return { combinations, diagnostics };
  }

  sortCombinations(
    combinations: Combination[],
    sortingOptionIndex: number,
    events: Immutable<Event[]>
  ): Combination[] {
    const sortingOption = this.sortingOptions[sortingOptionIndex];
    if (sortingOption === undefined) {
      throw new ErrorWithFields({
        message: `sorting option index was out of bounds`,
        fields: {
          sortingOptionIndex,
          actualSortingOptionsLength: this.sortingOptions.length,
          term: this.term,
        },
      });
    }

    return combinations
      .map((combination) => ({
        ...combination,
        factor: sortingOption.calculateFactor(combination, events),
      }))
      .sort((a, b) => a.factor - b.factor);
  }

  iterateTimeBlocks(
    crns: string[],
    events: Immutable<Event[]>,
    callback: (day: string, period: Period | undefined) => void
  ): void {
    const meetingCallback = (meeting: Meeting | Immutable<Event>): void =>
      meeting.period &&
      meeting.days.forEach((day) => {
        callback(day, meeting.period);
      });

    crns.forEach((crn) => {
      const section = this.findSection(crn);
      if (section !== undefined) {
        section.meetings.forEach(meetingCallback);
      }
    });

    events.forEach((event) => {
      if (event !== undefined) meetingCallback(event);
    });
  }
}

/**
 * Create an empty instance of the Oscar bean
 * to use as the default context value
 */
export const EMPTY_OSCAR = new Oscar(
  {
    courses: {},
    caches: {
      periods: [],
      dateRanges: [],
      scheduleTypes: [],
      campuses: [],
      attributes: [],
      gradeBases: [],
      locations: [],
      finalDates: [],
      finalTimes: [],
      fullCourseNames: {},
      restrictions: [],
      restrictionValues: {},
    },
    // This converts the Date to the expected string
    // that it serializes to in the crawler
    updatedAt: JSON.parse(JSON.stringify(new Date())) as string,
    version: 1,
  },
  '197008'
);
