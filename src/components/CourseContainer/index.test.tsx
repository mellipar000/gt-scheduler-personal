import React, { useContext, useMemo } from 'react';
import { render, screen } from '@testing-library/react';

import CourseContainer from '.';
import { ScheduleContext, ScheduleContextValue } from '../../contexts';
import Oscar from '../../data/beans/Oscar';
import { CrawlerTermData } from '../../types';
import fixture from '../../data/beans/__fixtures__/ae2610-202608.json';

jest.mock('..', () => ({
  Button: ({ children }: { children: React.ReactNode }): React.ReactElement => (
    <div>{children}</div>
  ),
  Course: ({ courseId }: { courseId: string }): React.ReactElement => (
    <div>{courseId}</div>
  ),
  CourseAdd: (): null => null,
  Event: (): null => null,
  EventAdd: (): null => null,
  ImportCoursesModal: (): null => null,
}));
jest.mock('../CourseNavMenu', () => (): null => null);

const oscar = new Oscar(fixture as unknown as CrawlerTermData, '202608');
function Harness({
  courses,
  pins,
  instance = oscar,
}: {
  courses: string[];
  pins: string[];
  instance?: Oscar;
}): React.ReactElement {
  const [base, actions] = useContext(ScheduleContext);
  const value = useMemo<ScheduleContextValue>(
    () => [
      {
        ...base,
        oscar: instance,
        desiredCourses: courses,
        pinnedCrns: pins,
        excludedCrns: [],
      },
      actions,
    ],
    [base, actions, instance, courses, pins]
  );
  return (
    <ScheduleContext.Provider value={value}>
      <CourseContainer />
    </ScheduleContext.Provider>
  );
}

it('updates the persistent sidebar total with courses, pins and term data', () => {
  const course = oscar.findCourse('AE 2610');
  if (!course) throw new Error('missing fixture');
  course.prepareRegistrationBundles();
  const crn = course.registrationBundles[0]?.[0]?.crn;
  if (!crn) throw new Error('missing bundle');
  const { rerender } = render(<Harness courses={['AE 2610']} pins={[]} />);
  expect(screen.getByText(/Selected credits:/).textContent).not.toContain(
    'Unresolved'
  );
  const unpinned = screen.getByText(/Selected credits:/).textContent;
  rerender(<Harness courses={['AE 2610']} pins={[crn]} />);
  expect(screen.getByText(/Selected credits:/).textContent).toBe(unpinned);
  rerender(<Harness courses={[]} pins={[]} />);
  expect(screen.getByText(/Selected credits:/).textContent).toContain(
    'Selected credits: 0'
  );
  const otherTerm = new Oscar(
    { ...fixture, courses: {} } as unknown as CrawlerTermData,
    '202702'
  );
  rerender(<Harness courses={['AE 2610']} pins={[]} instance={otherTerm} />);
  expect(screen.getByText(/Selected credits:/).textContent).toContain(
    'Unresolved'
  );
});
