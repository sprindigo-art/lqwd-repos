import React from 'react';
import Switch from './Switch';

const onChange = (event) => {
  console.log('changed to ' + event.target.value)

};

export default {
  title: 'Lqwd Basic/Switch',
  component: Switch,
};

export const primary = () => {
  return (
    <Switch
    initialValue={false}
    onChange={onChange}
    />
  );
};

export const primaryWithLabel = () => {
  const label = 'Enable This Item'
  return (
    <Switch
    label={label}
    onChange={onChange}
    />
  );
};

export const largeLabel = () => {
  const label = 'this is very long text which is very very very long. soooooooooooooooooooooooooooooooooooooo long'
  return (
    <Switch
    label={label}
    onChange={onChange}
    />
  );
};

export const WithDescripton = () => {
  const label = 'Enable This Item'
  const description = 'This is the complete description of how this item can affect the settings'
  return (
    <Switch
    label={label}
    onChange={onChange}
    description={description}
    />
  );
};



