import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { saveAs } from 'file-saver';

import ScheduleTransferControls from '.';
import { ScheduleContext, ScheduleContextValue } from '../../contexts/schedule';
import Oscar from '../../data/beans/Oscar';
import fixture from '../../data/beans/__fixtures__/ae2610-202608.json';
import { CrawlerTermData } from '../../types';
import { defaultSchedule } from '../../data/types';

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
const schedule = {
  ...defaultSchedule,
  desiredCourses: ['AE 2610'],
  pinnedCrns: ['86554', '84092'],
};
const transfer = {
  format: 'gt-scheduler-version',
  version: 1,
  term: '202608',
  name: 'Alternative',
  schedule,
};
function setup(): { imported: jest.Mock; input: HTMLElement } {
  const imported = jest.fn();
  const value = [
    {
      term: '202608',
      currentVersion: 'saved',
      oscar: new Oscar(fixture as unknown as CrawlerTermData, '202608'),
      versions: {
        saved: {
          name: 'Saved',
          schedule,
          friends: {},
          createdAt: '2026-10-31T00:00:00.000Z',
        },
      },
    },
    { importVersion: imported },
  ] as unknown as ScheduleContextValue;
  render(
    <ScheduleContext.Provider value={value}>
      <ScheduleTransferControls />
    </ScheduleContext.Provider>
  );
  return { imported, input: screen.getByLabelText('Preview version import') };
}
beforeEach(() => window.localStorage.clear());

it('previews without writes, cancels, then backs up before explicitly confirmed import', async () => {
  const { input, imported } = setup();
  const file = {
    size: 1000,
    text: (): Promise<string> => Promise.resolve(JSON.stringify(transfer)),
  };
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText(/New version: Alternative/);
  expect(imported).not.toHaveBeenCalled();
  expect(window.localStorage.length).toBe(0);
  fireEvent.click(screen.getByText('Cancel'));
  expect(screen.queryByText(/Confirm import/)).toBeNull();
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(await screen.findByText(/Confirm import as new version/));
  expect(window.localStorage.length).toBe(1);
  expect(saveAs).toHaveBeenCalled();
  expect(imported).toHaveBeenCalledWith('Alternative', schedule);
  const backup = JSON.parse(
    window.localStorage.getItem(window.localStorage.key(0)!)!
  ) as { terms: { '202608': { versions: object } } };
  expect(Object.keys(backup.terms['202608'].versions)).toEqual(['saved']);
});

it('rejects wrong-term data and aborts import if backup storage fails', async () => {
  const { input, imported } = setup();
  fireEvent.change(input, {
    target: {
      files: [
        {
          size: 100,
          text: (): Promise<string> =>
            Promise.resolve(JSON.stringify({ ...transfer, term: '202708' })),
        },
      ],
    },
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(imported).not.toHaveBeenCalled();
  fireEvent.change(input, {
    target: {
      files: [
        {
          size: 100,
          text: (): Promise<string> =>
            Promise.resolve(JSON.stringify(transfer)),
        },
      ],
    },
  });
  const confirm = await screen.findByText(/Confirm import as new version/);
  const spy = jest
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('quota')
  );
  expect(imported).not.toHaveBeenCalled();
  spy.mockRestore();
});
