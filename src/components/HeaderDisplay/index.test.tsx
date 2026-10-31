import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';

import HeaderDisplay, { HeaderDisplayProps } from '.';

jest.mock('../../hooks/useScreenWidth', () => (): boolean => true);
jest.mock('../../hooks/useMedia', () => (): boolean => true);

function props(
  currentVersion = 'a',
  currentTerm = '202608'
): HeaderDisplayProps {
  return {
    currentTab: 'Scheduler',
    onChangeTab: jest.fn(),
    onToggleMenu: jest.fn(),
    tabs: [],
    skeleton: true,
    termsState: {
      type: 'loaded',
      currentTerm,
      terms: [{ term: currentTerm, finalized: true }],
      onChangeTerm: jest.fn(),
    },
    paletteState: { type: 'loading' },
    accountState: { type: 'loading' },
    versionsState: {
      type: 'loaded',
      currentVersion,
      allVersionNames: [{ id: 'a', name: 'Primary' }],
      setCurrentVersion: jest.fn(),
      addNewVersion: jest.fn(),
      deleteVersion: jest.fn(),
      renameVersion: jest.fn(),
      cloneVersion: jest.fn(),
    },
  };
}
function openDelete(): void {
  if (!document.getElementById('a-delete')) {
    const selector = document.getElementById('version-selector-dropdown');
    if (!selector) throw new Error('Missing version selector');
    fireEvent.click(selector);
  }
  const button = document.getElementById('a-delete');
  if (!button) throw new Error('Missing delete action');
  fireEvent.click(button);
}

it('can delete the last version, cancels cleanly, and confirms exactly once', async () => {
  const config = props();
  render(<HeaderDisplay {...config} />);
  openDelete();
  expect(screen.getByText(/empty Primary/)).toBeDefined();
  fireEvent.click(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  if (config.versionsState.type !== 'loaded') throw new Error('Missing state');
  expect(config.versionsState.deleteVersion).not.toHaveBeenCalled();
  openDelete();
  fireEvent.click(screen.getByText('Delete', { selector: 'button' }));
  expect(config.versionsState.deleteVersion).toHaveBeenCalledTimes(1);
  expect(config.versionsState.deleteVersion).toHaveBeenCalledWith('a');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it.each(['escape', 'backdrop', 'version', 'term'])(
  'dismisses Delete Schedule on %s and can reopen it',
  async (reason) => {
    const config = props();
    const { rerender } = render(<HeaderDisplay {...config} />);
    openDelete();
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
    if (reason === 'version') rerender(<HeaderDisplay {...props('b')} />);
    if (reason === 'term')
      rerender(<HeaderDisplay {...props('a', '202702')} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    if (config.versionsState.type !== 'loaded')
      throw new Error('Missing state');
    expect(config.versionsState.deleteVersion).not.toHaveBeenCalled();
    openDelete();
    expect(screen.getByText('Delete', { selector: 'button' })).toBeDefined();
  }
);
