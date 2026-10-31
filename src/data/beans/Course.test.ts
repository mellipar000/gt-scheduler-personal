import axios from 'axios';

import Oscar from './Oscar';
import Course from './Course';
import fixture from './__fixtures__/ae2610-202608.json';
import { CrawlerTermData } from '../../types';
import { disableLogging } from '../../utils/tests';

jest.mock('axios');
// axios.get is replaced by Jest, so it has no instance binding.
// eslint-disable-next-line jest/unbound-method
const get = axios.get as jest.MockedFunction<typeof axios.get>;
function course(id = 'AE 2610'): Course {
  const data = JSON.parse(JSON.stringify(fixture)) as CrawlerTermData;
  const raw = data.courses['AE 2610'];
  if (!raw) throw new Error('Missing fixture');
  data.courses = { [id]: raw };
  const result = new Oscar(data, '202608').findCourse(id);
  if (!result) throw new Error('Missing course');
  return result;
}
const rows = [
  {
    instructor_name: 'Lovelace, Ada',
    class_size_group: 'Small (10-20 students)',
    GPA: 4,
    Term: 'Fall 2023',
  },
  {
    instructor_name: 'Hopper, Grace',
    class_size_group: 'Very Large (50 students or more)',
    GPA: 2,
    Term: 'Spring 2024',
  },
];
beforeEach(() => {
  disableLogging();
  window.localStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('fetches course and professor history directly, normalizes suffixes and caches results', async () => {
  get.mockResolvedValue({ data: { raw: rows } });
  const first = course('CHEM 1212K');
  const result = await first.fetchGpa();
  expect(get).toHaveBeenCalledWith(
    'https://c4citk6s9k.execute-api.us-east-1.amazonaws.com/prod/data/course?courseID=CHEM%201212',
    { timeout: 10000 }
  );
  expect(result.averageGpa).toBeCloseTo(160 / 65);
  expect(result['Ada Lovelace']).toBe(4);
  expect(result['Grace Hopper']).toBe(2);
  const second = course('CHEM 1212K');
  expect(await second.fetchGpa()).toEqual(result);
  expect(second.termInfo).toEqual(first.termInfo);
  expect(get).toHaveBeenCalledTimes(1);
});

it('coalesces simultaneous requests across course instances', async () => {
  get.mockResolvedValue({ data: { raw: rows } });
  const results = await Promise.all([course().fetchGpa(), course().fetchGpa()]);
  expect(results[0]).toEqual(results[1]);
  expect(get).toHaveBeenCalledTimes(1);
});

it.each([null, { raw: null }, { raw: [{}] }, { raw: [] }])(
  'settles malformed or empty data as unavailable: %j',
  async (data) => {
    get.mockResolvedValue({ data });
    expect(await course().fetchGpa()).toEqual({});
  }
);

it('settles network failures, avoids persistent failure caching, and allows retry', async () => {
  get.mockRejectedValue(new Error('offline'));
  expect(await course().fetchGpa()).toEqual({});
  expect(await course().fetchGpa()).toEqual({});
  expect(get).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem('course-gpa-cache-5')).toBeNull();
  jest.advanceTimersByTime(60001);
  get.mockResolvedValue({ data: { raw: rows } });
  expect((await course().fetchGpa()).averageGpa).toBeDefined();
  expect(get).toHaveBeenCalledTimes(2);
});

it('expires persistent data and ignores invalid GPAs without losing a valid zero', async () => {
  get.mockResolvedValue({
    data: {
      raw: [
        ...rows.map((row) => ({ ...row, GPA: NaN })),
        { ...rows[0], GPA: 0 },
        { ...rows[0], GPA: 5 },
      ],
    },
  });
  const first = course();
  expect((await first.fetchGpa()).averageGpa).toBe(0);
  jest.advanceTimersByTime(8 * 86400000);
  get.mockResolvedValue({ data: { raw: rows } });
  expect((await course().fetchGpa()).averageGpa).toBeCloseTo(160 / 65);
  expect(get).toHaveBeenCalledTimes(2);
});

it('works when browser storage is unavailable', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  get.mockResolvedValue({ data: { raw: rows } });
  expect((await course().fetchGpa())['Ada Lovelace']).toBe(4);
});
