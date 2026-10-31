import { renderHook, act } from '@testing-library/react';
import produce, { castDraft } from 'immer';

import useVersionActions from './useVersionActions';
import { defaultSchedule, TermScheduleData } from '../types';

it('defaults only new schedules to Efficient Week and preserves saved and cloned preferences', () => {
  let data: TermScheduleData = {
    versions: {
      saved: {
        name: 'Saved',
        createdAt: '2026-01-01',
        friends: {},
        schedule: { ...castDraft(defaultSchedule), sortingOptionIndex: 2 },
      },
    },
  };
  const { result } = renderHook(() =>
    useVersionActions({
      currentVersion: 'saved',
      setVersion: jest.fn(),
      updateTermScheduleData: (apply) => {
        data = produce(data, apply);
      },
    })
  );
  act(() => {
    result.current.addNewVersion('New');
    result.current.cloneVersion('saved', 'Clone');
  });
  expect(
    Object.values(data.versions).find((v) => v.name === 'New')?.schedule
      .sortingOptionIndex
  ).toBe(6);
  expect(
    Object.values(data.versions).find((v) => v.name === 'Clone')?.schedule
      .sortingOptionIndex
  ).toBe(2);
  expect(data.versions['saved']?.schedule.sortingOptionIndex).toBe(2);
});
