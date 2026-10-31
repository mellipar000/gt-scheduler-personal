import { Immutable } from 'immer';

import { Combination, Event } from '../../types';

export default class SortingOption {
  label: string;

  calculateFactor: (
    combo: Combination,
    events: Immutable<Event[]>
  ) => number | number[];

  constructor(
    label: string,
    calculateFactor: (
      combo: Combination,
      events: Immutable<Event[]>
    ) => number | number[]
  ) {
    this.label = label;
    this.calculateFactor = calculateFactor;
  }
}
