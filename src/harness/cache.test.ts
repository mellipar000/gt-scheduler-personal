import fs from 'fs';
import path from 'path';

import { snapshotFile } from './cli';

const term = '999991';
const filename = path.resolve('.local-data/crawler', `${term}.json`);
const fixture = fs.readFileSync(
  'src/data/beans/__fixtures__/ae2610-202608.json'
);
const response = (bytes: Buffer): Response =>
  ({
    ok: true,
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: (): Promise<{ done: boolean; value?: Buffer }> => {
            if (sent) return Promise.resolve({ done: true });
            sent = true;
            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
  } as unknown as Response);

beforeEach(() => {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (fs.existsSync(filename)) fs.unlinkSync(filename);
});
afterAll(() => {
  if (fs.existsSync(filename)) fs.unlinkSync(filename);
});

it('fetches missing snapshots, reuses fresh cache and refreshes stale snapshots', async () => {
  const fetchMock = jest.fn().mockResolvedValue(response(fixture));
  global.fetch = fetchMock;
  expect(await snapshotFile(term)).toBe(filename);
  expect(await snapshotFile(term)).toBe(filename);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const old = new Date(Date.now() - 61 * 60 * 1000);
  fs.utimesSync(filename, old, old);
  await snapshotFile(term);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('warns and retains the last valid cache when refresh fails or is invalid', async () => {
  fs.writeFileSync(filename, fixture);
  const old = new Date(Date.now() - 61 * 60 * 1000);
  fs.utimesSync(filename, old, old);
  const warn = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(jest.fn());
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response(Buffer.from('{}')));
  await snapshotFile(term);
  await snapshotFile(term);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(fs.readFileSync(filename)).toEqual(fixture);
  fs.unlinkSync(filename);
  await expect(snapshotFile(term)).rejects.toThrow('Unable to refresh');
});
