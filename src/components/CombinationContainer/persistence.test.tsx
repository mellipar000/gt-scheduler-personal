import React, { useContext, useMemo, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { castDraft } from 'immer';

import CombinationContainer from '.';
import { ContextProvider } from '../AppDataLoader';
import { OverlayCrnsContext, ScheduleContext } from '../../contexts';
import useRawScheduleDataFromStorage, {
  SCHEDULE_DATA_LOCAL_STORAGE_KEY,
} from '../../data/hooks/useRawScheduleDataFromStorage';
import useScheduleDataProducer from '../../data/hooks/useScheduleDataProducer';
import useExtractTermScheduleData from '../../data/hooks/useExtractTermScheduleData';
import useExtractScheduleVersion from '../../data/hooks/useExtractScheduleVersion';
import { defaultSchedule, ScheduleData } from '../../data/types';

jest.mock('../../hooks/useScreenWidth', () => (): boolean => true);
jest.mock('../../hooks/useMedia', () => (): boolean => true);

const schedule = {
  ...castDraft(defaultSchedule),
  desiredCourses: ['CS 1331'],
  pinnedCrns: ['12345'],
  excludedCrns: ['67890'],
  events: [
    {
      id: 'e',
      name: 'Work',
      days: ['F'] as 'F'[],
      period: { start: 600, end: 660 },
    },
  ],
  sortingOptionIndex: 2,
};
const version = {
  name: 'Test',
  createdAt: '2026-01-01',
  friends: {},
  schedule,
};

function Controls(): React.ReactElement {
  const [{ pinnedCrns }, { patchSchedule, setCurrentVersion }] =
    useContext(ScheduleContext);
  const [overlay, setOverlay] = useState<string[]>([]);
  const overlayContext = useMemo<[string[], typeof setOverlay]>(
    () => [overlay, setOverlay],
    [overlay]
  );
  return (
    <OverlayCrnsContext.Provider value={overlayContext}>
      <button type="button" onClick={(): void => setCurrentVersion('b')}>
        Switch
      </button>
      <button
        type="button"
        onClick={(): void => {
          patchSchedule({ pinnedCrns: ['12345'] });
          setOverlay(['preview']);
        }}
      >
        Pin
      </button>
      <output data-testid="pins">{JSON.stringify(pinnedCrns)}</output>
      <output data-testid="preview">{JSON.stringify(overlay)}</output>
      <CombinationContainer />
    </OverlayCrnsContext.Provider>
  );
}

function App(): React.ReactElement {
  const raw = useRawScheduleDataFromStorage();
  if (raw.type !== 'loaded' || !raw.result.rawScheduleData)
    throw new Error('missing storage');
  return (
    <Loaded
      data={raw.result.rawScheduleData as ScheduleData}
      setData={(next): void =>
        raw.result.setRawScheduleData((current) =>
          typeof next === 'function' ? next(current as ScheduleData) : next
        )
      }
    />
  );
}
function Loaded({
  data,
  setData,
}: {
  data: ScheduleData;
  setData: (
    value: ScheduleData | ((current: ScheduleData) => ScheduleData)
  ) => void;
}): React.ReactElement {
  const [currentVersion, setVersion] = useState('a');
  const { updateScheduleData } = useScheduleDataProducer({
    setScheduleData: setData,
  });
  const term = useExtractTermScheduleData({
    currentTerm: '202608',
    scheduleData: data,
    updateScheduleData,
  });
  if (term.type !== 'loaded') throw new Error('missing term');
  return (
    <Version
      term={term.result}
      currentVersion={currentVersion}
      setVersion={setVersion}
    />
  );
}
function Version({
  term,
  currentVersion,
  setVersion,
}: {
  term: Extract<
    ReturnType<typeof useExtractTermScheduleData>,
    { type: 'loaded' }
  >['result'];
  currentVersion: string;
  setVersion: (v: string) => void;
}): React.ReactElement {
  const extracted = useExtractScheduleVersion({
    ...term,
    currentVersionRaw: currentVersion,
    setVersion,
  });
  const [{ oscar }] = useContext(ScheduleContext);
  if (extracted.type !== 'loaded') throw new Error('missing version');
  return (
    <ContextProvider
      terms={[]}
      currentTerm="202608"
      setTerm={jest.fn()}
      setVersion={setVersion}
      oscar={oscar}
      {...extracted.result}
      {...term}
      accountState={{ type: 'signedOut' }}
      friendScheduleData={{}}
      updateFriendTermData={jest.fn()}
      updateFriendInfo={jest.fn()}
    >
      <Controls />
    </ContextProvider>
  );
}

it('persists repeated confirmed resets across versions and reloads', () => {
  localStorage.clear();
  localStorage.setItem(
    SCHEDULE_DATA_LOCAL_STORAGE_KEY,
    JSON.stringify({
      version: 3,
      terms: { '202608': { versions: { a: version, b: version } } },
    })
  );
  const view = render(<App />);
  const reset = (): void => {
    fireEvent.click(screen.getByText('Reset Sections'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('pins').textContent).toBe('[]');
    expect(screen.getByTestId('preview').textContent).toBe('[]');
  };
  fireEvent.click(screen.getByText('Pin'));
  reset();
  fireEvent.click(screen.getByText('Pin'));
  reset();
  fireEvent.click(screen.getByText('Switch'));
  fireEvent.click(screen.getByText('Pin'));
  reset();
  view.unmount();
  const stored = JSON.parse(
    localStorage.getItem(SCHEDULE_DATA_LOCAL_STORAGE_KEY)!
  ) as ScheduleData;
  expect(stored.terms['202608']?.versions['a']?.schedule).toEqual({
    ...schedule,
    pinnedCrns: [],
  });
  expect(stored.terms['202608']?.versions['b']?.schedule).toEqual({
    ...schedule,
    pinnedCrns: [],
  });
  render(<App />);
  expect(screen.getByTestId('pins').textContent).toBe('[]');
});
