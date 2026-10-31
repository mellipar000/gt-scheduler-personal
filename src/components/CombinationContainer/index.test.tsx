import React, { useContext, useMemo, useState } from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { castDraft } from 'immer';

import CombinationContainer from '.';
import {
  ScheduleContext,
  ScheduleContextValue,
  OverlayCrnsContext,
  OverlayCrnsContextValue,
} from '../../contexts';
import { defaultSchedule, Schedule } from '../../data/types';

jest.mock('../../hooks/useScreenWidth', () => (): boolean => true);
jest.mock('../../hooks/useMedia', () => (): boolean => true);

const initial: Schedule = {
  ...castDraft(defaultSchedule),
  desiredCourses: ['CS 1331'],
  pinnedCrns: ['12345'],
  excludedCrns: ['67890'],
  events: [
    { id: 'e', name: 'Work', days: ['F'], period: { start: 600, end: 660 } },
  ],
  sortingOptionIndex: 2,
};
function Harness({ version = 'a', term = '202608' }): React.ReactElement {
  const [baseData, baseActions] = useContext(ScheduleContext);
  const [schedule, setSchedule] = useState(initial);
  const [overlay, setOverlay] = useState(['preview']);
  const context = useMemo<ScheduleContextValue>(
    () => [
      { ...baseData, ...schedule, term, currentVersion: version },
      {
        ...baseActions,
        patchSchedule: (patch) => setSchedule((s) => ({ ...s, ...patch })),
      },
    ],
    [baseData, baseActions, schedule, term, version]
  );
  const overlayContext = useMemo<OverlayCrnsContextValue>(
    () => [overlay, setOverlay],
    [overlay]
  );
  return (
    <ScheduleContext.Provider value={context}>
      <OverlayCrnsContext.Provider value={overlayContext}>
        <CombinationContainer />
        <output data-testid="schedule">{JSON.stringify(schedule)}</output>
        <output data-testid="overlay">{JSON.stringify(overlay)}</output>
      </OverlayCrnsContext.Provider>
    </ScheduleContext.Provider>
  );
}

it('cancels and confirms reset without deleting courses, events, exclusions or preferences', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('Reset Sections'));
  expect(screen.getByText(/Clear all pinned sections/)).toBeDefined();
  fireEvent.click(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    JSON.parse(screen.getByTestId('schedule').textContent ?? '{}')
  ).toEqual(initial);
  fireEvent.click(screen.getByText('Reset Sections'));
  fireEvent.click(screen.getByText('Reset', { selector: 'button' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(
    JSON.parse(screen.getByTestId('schedule').textContent ?? '{}')
  ).toEqual({ ...initial, pinnedCrns: [] });
  expect(screen.getByTestId('overlay').textContent).toBe('[]');
  expect(
    screen.getByText('Reset Sections').classList.contains('disabled')
  ).toBe(true);
});

it.each(['escape', 'backdrop', 'version', 'term'])(
  'dismisses reset on %s without applying a stale action',
  async (reason) => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByText('Reset Sections'));
    if (reason === 'escape')
      fireEvent.keyDown(screen.getByRole('dialog'), {
        key: 'Escape',
        keyCode: 27,
      });
    if (reason === 'backdrop') {
      const backdrop = document.querySelector('.modal-backdrop');
      if (!backdrop) throw new Error('Missing backdrop');
      fireEvent.click(backdrop);
    }
    if (reason === 'version') rerender(<Harness version="b" />);
    if (reason === 'term') rerender(<Harness term="202702" />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      JSON.parse(screen.getByTestId('schedule').textContent ?? '{}')
    ).toEqual(initial);
  }
);
