import { useCallback } from 'react';
import { renderHook, act, fireEvent } from '@testing-library/react';
import produce, { castDraft, Immutable } from 'immer';

import useRawScheduleDataFromStorage, {
  SCHEDULE_DATA_LOCAL_STORAGE_KEY,
} from './useRawScheduleDataFromStorage';
import useUIStateFromStorage, {
  UI_STATE_LOCAL_STORAGE_KEY,
} from './useUIStateFromStorage';
import useExtractTermScheduleData from './useExtractTermScheduleData';
import useExtractScheduleVersion from './useExtractScheduleVersion';
import useVersionActions from './useVersionActions';
import { defaultSchedule, ScheduleData, ScheduleVersion } from '../types';

const version = (name: string): ScheduleVersion => ({
  name,
  createdAt: `2026-01-0${name === 'a' ? 1 : 2}`,
  friends: {},
  schedule: {
    ...castDraft(defaultSchedule),
    desiredCourses: ['CS 1331'],
    pinnedCrns: [name],
    excludedCrns: ['excluded'],
    events: [
      { id: 'e', name: 'Work', days: ['M'], period: { start: 600, end: 660 } },
    ],
    sortingOptionIndex: 3,
  },
});
function seed(): ScheduleData {
  return {
    version: 3,
    terms: {
      '202608': { versions: { a: version('a'), b: version('b') } },
      '202702': { versions: { other: version('other') } },
    },
  };
}
beforeEach(() => {
  localStorage.setItem(SCHEDULE_DATA_LOCAL_STORAGE_KEY, JSON.stringify(seed()));
  localStorage.setItem(
    UI_STATE_LOCAL_STORAGE_KEY,
    JSON.stringify({
      currentTerm: '202608',
      versionStates: {
        '202608': { currentVersion: 'a' },
        '202702': { currentVersion: 'other' },
      },
    })
  );
});
afterEach(() => localStorage.clear());

// Exercise the production persistence/extraction/action hooks together.
function usePersistedSchedule(): {
  ui: ReturnType<typeof useUIStateFromStorage>;
  actions: ReturnType<typeof useVersionActions>;
  selection: ReturnType<typeof useExtractScheduleVersion>;
  raw: Immutable<ScheduleData>;
} {
  const storage = useRawScheduleDataFromStorage();
  const ui = useUIStateFromStorage();
  if (
    storage.type !== 'loaded' ||
    storage.result.rawScheduleData?.version !== 3
  )
    throw new Error('Missing seeded data');
  const { setRawScheduleData, rawScheduleData } = storage.result;
  const updateScheduleData: Parameters<
    typeof useExtractTermScheduleData
  >[0]['updateScheduleData'] = useCallback(
    (apply) => {
      setRawScheduleData((current) => {
        if (current?.version !== 3) throw new Error('Missing current data');
        return produce(current, apply);
      });
    },
    [setRawScheduleData]
  );
  const term = useExtractTermScheduleData({
    currentTerm: ui.currentTerm,
    scheduleData: rawScheduleData,
    updateScheduleData,
  });
  if (term.type !== 'loaded') throw new Error('Missing seeded term');
  const selection = useExtractScheduleVersion({
    ...term.result,
    currentVersionRaw: ui.currentVersion,
    setVersion: ui.setVersion,
  });
  const actions = useVersionActions({
    updateTermScheduleData: term.result.updateTermScheduleData,
    currentVersion: ui.currentVersion,
    setVersion: ui.setVersion,
  });
  return {
    ui,
    actions,
    selection,
    raw: rawScheduleData,
  };
}
function persisted(): ScheduleData {
  return JSON.parse(
    localStorage.getItem(SCHEDULE_DATA_LOCAL_STORAGE_KEY) ?? '{}'
  ) as ScheduleData;
}

it('persists pin reset, preserves all other fields and versions, and survives remount', () => {
  const { result, unmount } = renderHook(usePersistedSchedule);
  act(() => {
    if (result.current.selection.type !== 'loaded')
      throw new Error('Missing selection');
    result.current.selection.result.updateScheduleVersion((draft) => {
      draft.schedule.pinnedCrns = [];
    });
  });
  const expected = seed();
  const a = expected.terms['202608']?.versions['a'];
  if (!a) throw new Error('Missing seed');
  a.schedule.pinnedCrns = [];
  expect(persisted()).toEqual(expected);
  expect(result.current.raw).toEqual(expected);
  unmount();
  const reloaded = renderHook(usePersistedSchedule);
  expect(reloaded.result.current.ui.currentVersion).toBe('a');
  expect(reloaded.result.current.raw).toEqual(expected);
});

it('persists deletion and surviving selection, then safely replaces the final version', () => {
  const { result, unmount } = renderHook(usePersistedSchedule);
  act(() => result.current.actions.deleteVersion('a'));
  expect(result.current.ui.currentVersion).toBe('b');
  expect(persisted().terms['202608']?.versions['a']).toBeUndefined();
  expect(persisted().terms['202702']).toEqual(seed().terms['202702']);
  unmount();
  const reloaded = renderHook(usePersistedSchedule);
  expect(reloaded.result.current.ui.currentVersion).toBe('b');
  act(() => reloaded.result.current.actions.deleteVersion('b'));
  const id = reloaded.result.current.ui.currentVersion;
  expect(id).not.toBe('b');
  expect(persisted().terms['202608']?.versions[id]?.schedule).toEqual(
    defaultSchedule
  );
  expect(reloaded.result.current.selection.type).toBe('loaded');
});

it('synchronizes cross-tab deletion and recovers a valid persisted selection', () => {
  const { result } = renderHook(usePersistedSchedule);
  const incoming = seed();
  delete incoming.terms['202608']?.versions['a'];
  act(() => {
    localStorage.setItem(
      SCHEDULE_DATA_LOCAL_STORAGE_KEY,
      JSON.stringify(incoming)
    );
    fireEvent(
      window,
      new StorageEvent('storage', {
        key: SCHEDULE_DATA_LOCAL_STORAGE_KEY,
        newValue: JSON.stringify(incoming),
        storageArea: localStorage,
      })
    );
  });
  expect(result.current.raw).toEqual(incoming);
  expect(result.current.ui.currentVersion).toBe('b');
  expect(result.current.selection.type).toBe('loaded');
});

it('keeps a delayed version callback bound to the originating term', () => {
  const { result } = renderHook(usePersistedSchedule);
  const oldSetVersion = result.current.ui.setVersion;
  act(() => result.current.ui.setTerm('202702'));
  act(() => oldSetVersion('b'));
  expect(result.current.ui.currentTerm).toBe('202702');
  expect(result.current.ui.currentVersion).toBe('other');
  act(() => result.current.ui.setTerm('202608'));
  expect(result.current.ui.currentVersion).toBe('b');
});
