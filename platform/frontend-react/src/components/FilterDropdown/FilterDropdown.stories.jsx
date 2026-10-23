/* eslint-disable */
import React from 'react';
import FilterDropdown from "./FilterDropdown";

export default {
  title: 'LQwD Basic/Filter Dropdown',
  component: FilterDropdown
};

export const filter = () => {
  const text = 'Filter';

  const filterOptions = [
    { key: 'chocolate', value: 'Chocolate', id: 1, selected: false },
    { key: 'strawberry', value: 'Strawberry', id: 2, selected: false },
    { key: 'vanilla', value: 'Vanilla', id: 3, selected: false }
  ];

  return (
    <FilterDropdown filterTitle={text} filterOptions={filterOptions}></FilterDropdown>
  );
};