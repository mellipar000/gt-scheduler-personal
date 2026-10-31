import React, { useContext, useEffect, useRef, useState } from 'react';
import { saveAs } from 'file-saver';

import { ScheduleContext } from '../../contexts';
import {
  ScheduleTransfer,
  transferSchema,
  validateTransfer,
} from '../../data/scheduleTransfer';
import { SCHEDULE_DATA_LOCAL_STORAGE_KEY } from '../../data/hooks/useRawScheduleDataFromStorage';

export default function ScheduleTransferControls(): React.ReactElement {
  const [data, { importVersion }] = useContext(ScheduleContext);
  const [pending, setPending] = useState<ScheduleTransfer | null>(null);
  const [error, setError] = useState('');
  const readId = useRef(0);
  useEffect(() => {
    setPending(null);
    setError('');
    return () => {
      readId.current += 1;
    };
  }, [data.term, data.currentVersion]);
  const download = (value: unknown, name: string): void => {
    saveAs(
      new Blob([JSON.stringify(value)], { type: 'application/json' }),
      name
    );
  };
  return (
    <details>
      <summary>Schedule JSON import / export</summary>
      <button
        type="button"
        onClick={(): void => {
          try {
            const version = data.versions[data.currentVersion];
            if (version)
              download(
                transferSchema.parse({
                  format: 'gt-scheduler-version',
                  version: 1,
                  term: data.term,
                  name: version.name,
                  schedule: version.schedule,
                }),
                `schedule-${data.term}.json`
              );
          } catch (reason) {
            setError(String(reason));
          }
        }}
      >
        Export current version
      </button>
      <label htmlFor="schedule-version-import">
        Preview version import
        <input
          id="schedule-version-import"
          type="file"
          accept=".json,application/json"
          disabled={!importVersion}
          onChange={(event): void => {
            const file = event.target.files?.[0];
            readId.current += 1;
            const thisRead = readId.current;
            event.target.value = '';
            setPending(null);
            setError('');
            if (!file) return;
            if (file.size > 1024 * 1024) {
              setError('Import exceeds 1 MiB');
              return;
            }
            file
              .text()
              .then((text) => {
                if (readId.current !== thisRead) return;
                setPending(
                  validateTransfer(JSON.parse(text) as unknown, data.oscar)
                );
              })
              .catch((reason: unknown) => {
                if (readId.current === thisRead) setError(String(reason));
              });
          }}
        />
      </label>
      {pending && (
        <div>
          <p>
            New version: {pending.name}. Courses:{' '}
            {pending.schedule.desiredCourses.join(', ')}. Pinned CRNs:{' '}
            {pending.schedule.pinnedCrns.join(', ') || 'none'}. Existing
            versions will be preserved.
          </p>
          <button
            type="button"
            onClick={(): void => {
              try {
                const validated = validateTransfer(pending, data.oscar);
                const backup = JSON.stringify({
                  version: 3,
                  terms: { [data.term]: { versions: data.versions } },
                });
                const key = `${SCHEDULE_DATA_LOCAL_STORAGE_KEY}-backup-${Date.now()}`;
                window.localStorage.setItem(key, backup);
                download(JSON.parse(backup) as unknown, `${key}.json`);
                importVersion?.(validated.name, validated.schedule);
                setPending(null);
              } catch (reason) {
                setError(String(reason));
              }
            }}
          >
            Confirm import as new version (creates backup)
          </button>
          <button type="button" onClick={(): void => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
