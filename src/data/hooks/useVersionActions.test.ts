import { renderHook, act } from '@testing-library/react';
import produce, { castDraft } from 'immer';

import useVersionActions from './useVersionActions';
import { defaultSchedule, TermScheduleData } from '../types';
import { disableLogging } from '../../utils/tests';

it('appends and selects an imported version while preserving existing schedules and shares', () => {
  const saved = {
    name: 'Saved',
    createdAt: '2026-10-31',
    friends: {},
    schedule: castDraft(defaultSchedule),
  };
  let data: TermScheduleData = { versions: { saved } };
  const setVersion = jest.fn();
  const { result } = renderHook(() =>
    useVersionActions({
      currentVersion: 'saved',
      setVersion,
      updateTermScheduleData: (apply) => {
        data = produce(data, apply);
      },
    })
  );
  const imported = {
    ...castDraft(defaultSchedule),
    desiredCourses: ['AE 2610'],
    pinnedCrns: ['86554', '84092'],
  };
  act(() => {
    result.current.importVersion('Alternative', imported);
  });
  expect(data.versions['saved']).toEqual(saved);
  expect(Object.keys(data.versions)).toHaveLength(2);
  const id = Object.keys(data.versions).find(
    (key) => key !== 'saved'
  ) as string;
  expect(data.versions[id]?.schedule).toEqual(imported);
  expect(data.versions[id]?.friends).toEqual({});
  expect(setVersion).toHaveBeenCalledWith(id);
});

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

describe('deleting schedule versions', () => {
  beforeEach(disableLogging);
  it.each([
    ['a', 'a', 'b'],
    ['b', 'b', 'a'],
    ['c', 'c', 'b'],
    ['b', 'a', null],
    ['a', 'missing', null],
  ])(
    'selects a surviving neighbor: current=%s deleted=%s',
    (currentVersion, deleting, selected) => {
      // Deliberately insert out of chronological order.
      let data: TermScheduleData = {
        versions: Object.fromEntries(
          ['c', 'a', 'b'].map((id) => [
            id,
            {
              name: id,
              createdAt: `2026-01-0${id.charCodeAt(0) - 96}`,
              friends: {},
              schedule: {
                ...castDraft(defaultSchedule),
                pinnedCrns: [id],
                desiredCourses: ['CS 1331'],
              },
            },
          ])
        ),
      };
      const original = data;
      const setVersion = jest.fn();
      const { result } = renderHook(() =>
        useVersionActions({
          currentVersion,
          setVersion,
          updateTermScheduleData: (apply) => {
            data = produce(data, apply);
          },
        })
      );
      act(() => result.current.deleteVersion(deleting));
      if (selected) {
        expect(setVersion).toHaveBeenCalledWith(selected);
        expect(data.versions[selected]).toBeDefined();
      } else expect(setVersion).not.toHaveBeenCalled();
      Object.keys(data.versions).forEach((id) =>
        expect(data.versions[id]).toEqual(original.versions[id])
      );
      expect(data.versions[deleting]).toBeUndefined();
    }
  );

  it('creates a fresh empty Primary after deleting the last version, and ignores repeated deletion', () => {
    let data: TermScheduleData = {
      versions: {
        only: {
          name: 'Only',
          createdAt: '2026-01-01',
          friends: {},
          schedule: {
            ...castDraft(defaultSchedule),
            desiredCourses: ['CS 1331'],
            pinnedCrns: ['12345'],
            events: [
              {
                id: 'e',
                name: 'Work',
                days: ['M'],
                period: { start: 600, end: 660 },
              },
            ],
          },
        },
      },
    };
    const setVersion = jest.fn();
    const { result } = renderHook(() =>
      useVersionActions({
        currentVersion: 'only',
        setVersion,
        updateTermScheduleData: (apply) => {
          data = produce(data, apply);
        },
      })
    );
    act(() => {
      result.current.deleteVersion('only');
      result.current.deleteVersion('only');
    });
    expect(setVersion).toHaveBeenCalledTimes(1);
    const entries = Object.entries(data.versions);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) throw new Error('Missing replacement');
    expect(setVersion).toHaveBeenCalledWith(entry[0]);
    expect(entry[1].name).toBe('Primary');
    expect(entry[1].schedule).toEqual(defaultSchedule);
  });
});
