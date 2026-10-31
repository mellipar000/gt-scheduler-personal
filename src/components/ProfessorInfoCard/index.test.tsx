import React from 'react';
import { render } from '@testing-library/react';

import ProfessorInfoCard from '.';
import Oscar from '../../data/beans/Oscar';
import { CrawlerTermData } from '../../types';
import fixture from '../../data/beans/__fixtures__/ae2610-202608.json';

it('distinguishes loading, unavailable, and a valid zero historical professor GPA', () => {
  const course = new Oscar(
    fixture as unknown as CrawlerTermData,
    '202608'
  ).findCourse('AE 2610');
  if (!course) throw new Error('Missing fixture');
  const props = {
    course,
    professorName: 'Professor',
    displaySectionInfo: false,
  };
  const { getByText, rerender } = render(
    <ProfessorInfoCard {...props} professorGpa={undefined} />
  );
  expect(getByText('Loading...')).toBeDefined();
  rerender(<ProfessorInfoCard {...props} professorGpa={null} />);
  expect(getByText('Unavailable')).toBeDefined();
  rerender(<ProfessorInfoCard {...props} professorGpa={0} />);
  expect(getByText('0.00')).toBeDefined();
});

it('links to a school-scoped professor search separately from historical GPA', () => {
  const course = new Oscar(
    fixture as unknown as CrawlerTermData,
    '202608'
  ).findCourse('AE 2610');
  if (!course) throw new Error('Missing fixture');
  const { getByRole, getByText, rerender, queryByRole } = render(
    <ProfessorInfoCard
      course={course}
      professorName="Ada Lovelace"
      professorGpa={3.2}
      displaySectionInfo={false}
    />
  );
  expect(getByText('Course Critique GPA')).toBeDefined();
  expect(
    getByRole('link', { name: /Search Rate My Professors/ }).getAttribute(
      'href'
    )
  ).toBe(
    'https://www.ratemyprofessors.com/search/professors/361?q=Ada%20Lovelace'
  );
  rerender(
    <ProfessorInfoCard
      course={course}
      professorName="TBA"
      professorGpa={null}
      displaySectionInfo={false}
    />
  );
  expect(queryByRole('link', { name: /Search Rate My Professors/ })).toBeNull();
});
