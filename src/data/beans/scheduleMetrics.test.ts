import scheduleMetrics from './scheduleMetrics';
import { Meeting } from '../../types';
import { FALLBACK_GT_LOCATIONS } from '../../utils/mapbox/constants';
import { getTravel } from '../../utils/mapbox/misc';

const locationA = FALLBACK_GT_LOCATIONS[0]?.coords ?? null;
const locationB = FALLBACK_GT_LOCATIONS[1]?.coords ?? null;
function meeting(
  start: number,
  end: number,
  overrides: Partial<Meeting> = {}
): Meeting {
  return {
    period: { start, end },
    days: ['M'],
    where: 'Room',
    location: locationA,
    instructors: [],
    dateRange: { from: new Date(2026, 7, 24), to: new Date(2026, 7, 24) },
    finalDate: null,
    finalTime: null,
    ...overrides,
  };
}
const section = (
  meetings: Meeting[],
  deliveryMode?: string
): Parameters<typeof scheduleMetrics>[0][number] => ({
  meetings,
  deliveryMode,
  campus: 'Atlanta',
});

it('orders every meeting chronologically and includes multiple meetings per section', () => {
  const metrics = scheduleMetrics([
    section([meeting(780, 830), meeting(540, 590)]),
    section([meeting(600, 650, { location: locationB })]),
  ]);
  expect(metrics).toEqual({
    classDays: 1,
    idleMinutes: 140,
    unknownTrips: 0,
    walkingSeconds:
      (getTravel(locationA, locationB) ?? 0) +
      (getTravel(locationB, locationA) ?? 0),
  });
});

it('only connects meetings that occur on the same actual date', () => {
  expect(
    scheduleMetrics([
      section([meeting(540, 590)]),
      section([
        meeting(780, 830, {
          dateRange: { from: new Date(2026, 7, 31), to: new Date(2026, 7, 31) },
        }),
      ]),
    ])
  ).toEqual({
    classDays: 1,
    idleMinutes: 0,
    unknownTrips: 0,
    walkingSeconds: 0,
  });
});

it('handles partial ranges, weekends and days without an actual occurrence', () => {
  const result = scheduleMetrics([
    section([
      meeting(540, 590, {
        days: ['S'],
        dateRange: { from: new Date(2026, 7, 29), to: new Date(2026, 7, 29) },
      }),
      meeting(600, 650, { days: ['T'] }),
    ]),
  ]);
  expect(result.classDays).toBe(0);
  expect(result.idleMinutes).toBe(0);
});

it('excludes async meetings and remote class days, but counts synchronous gaps', () => {
  expect(
    scheduleMetrics([
      section([meeting(540, 590)], 'Remote Asynchronous Course'),
      section(
        [meeting(600, 650), meeting(700, 750)],
        'Remote Synchronous Course'
      ),
    ])
  ).toEqual({
    classDays: 0,
    idleMinutes: 50,
    unknownTrips: 0,
    walkingSeconds: 0,
  });
});

it('distinguishes missing and unknown routes from confirmed zero walking time', () => {
  expect(getTravel(null, locationA)).toBeNull();
  expect(getTravel({ lat: 1, long: 1 }, locationA)).toBeNull();
  expect(getTravel(locationA, locationA)).toBe(0);
  expect(
    scheduleMetrics([
      section([
        meeting(540, 590),
        meeting(600, 650, { location: null }),
        meeting(700, 750),
      ]),
    ]).unknownTrips
  ).toBe(2);
});
