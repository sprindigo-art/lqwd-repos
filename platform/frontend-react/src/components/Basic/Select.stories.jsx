import React from 'react';
import Select from './Select';

export default {
  title: 'Lqwd Basic/Select',
  component: Select,
};

const options = [
  {value: 'canada', label: 'Canada'},
  {value: 'france', label: 'France'},
  {value: 'germany', label: 'Germany'},
  {value: 'usa', label: 'USA'},
]

export const primary = () => {
  return (
    <Select
    initialValue={options[0]}
    options={options}
    />
  );
};

export const Placeholder = () => {
  
  return (
    <Select
    initialValue={options[0]}
    options={options}
    placeholder="please select a country"
    />
  );
};

export const witLabel = () => {
  const label = 'Countries'
  return (
    <Select
    options={options}
    label={label}
    />
  );
};

