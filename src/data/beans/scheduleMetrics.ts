import type Section from './Section';
import { Meeting, Period } from '../../types';
import { ASYNC_DELIVERY_MODE } from '../../constants';
import { getTravel } from '../../utils/mapbox/misc';

export interface ScheduleMetrics {
  classDays: number;
  idleMinutes: number;
  unknownTrips: number;
  walkingSeconds: number;
}

// UTC civil-day numbers avoid DST shifts while respecting crawler local dates.
const civilDay = (date: Date): number =>
  Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;

const occurrences = new WeakMap<Meeting, number[]>();
function meetingDates(meeting: Meeting): number[] {
  const cached = occurrences.get(meeting);
  if (cached) return cached;
  const dates: number[] = [];
  const end = civilDay(meeting.dateRange.to);
  for (let day = civilDay(meeting.dateRange.from); day <= end; day++) {
    const weekday = 'UMTWRFS'[new Date(day * 86400000).getUTCDay()];
    if (weekday && meeting.days.includes(weekday)) dates.push(day);
  }
  occurrences.set(meeting, dates);
  return dates;
}

function isRemote(
  section: Pick<Section, 'campus' | 'deliveryMode'>,
  meeting: Meeting
): boolean {
  return (
    section.deliveryMode === 'Remote Synchronous Course' ||
    /online|video/i.test(section.campus) ||
    /\b(remote|online|virtual|internet)\b/i.test(meeting.where)
  );
}

/** Gaps and trips are totals over actual meeting dates. */
export default function scheduleMetrics(
  sections: Pick<Section, 'meetings' | 'campus' | 'deliveryMode'>[]
): ScheduleMetrics {
  const timelines = new Map<
    number,
    { meeting: Meeting; physical: boolean; period: Period }[]
  >();
  const weekdays = new Set<number>();
  sections.forEach((section) => {
    if (section.deliveryMode === ASYNC_DELIVERY_MODE) return;
    section.meetings.forEach((meeting) => {
      const { period } = meeting;
      if (!period) return;
      const physical = !isRemote(section, meeting);
      meetingDates(meeting).forEach((date) => {
        const weekday = new Date(date * 86400000).getUTCDay();
        if (physical && weekday >= 1 && weekday <= 5) weekdays.add(weekday);
        const timeline = timelines.get(date) ?? [];
        timeline.push({ meeting, physical, period });
        timelines.set(date, timeline);
      });
    });
  });
  let idleMinutes = 0;
  let unknownTrips = 0;
  let walkingSeconds = 0;
  timelines.forEach((timeline) => {
    timeline.sort(
      (a, b) => a.period.start - b.period.start || a.period.end - b.period.end
    );
    let previousEnd: number | undefined;
    let previousPhysical: Meeting | undefined;
    timeline.forEach(({ meeting, physical, period }) => {
      if (previousEnd !== undefined)
        idleMinutes += Math.max(0, period.start - previousEnd);
      previousEnd = Math.max(previousEnd ?? 0, period.end);
      if (physical) {
        if (previousPhysical) {
          const travel = getTravel(previousPhysical.location, meeting.location);
          if (travel === null) unknownTrips += 1;
          else walkingSeconds += travel;
        }
        previousPhysical = meeting;
      }
    });
  });
  return {
    classDays: weekdays.size,
    idleMinutes,
    unknownTrips,
    walkingSeconds,
  };
}
