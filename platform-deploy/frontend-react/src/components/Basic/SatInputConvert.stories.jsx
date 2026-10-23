import React from 'react';
import SatInputConvert from './SatInputConvert';

export default {
  title: 'Lqwd Basic/Sat Input Convert',
  component: SatInputConvert,
};

export const primary = () => {
  const text = 'some text'
  const label = 'Label'

  const onChange = () => {
    console.log('Sat Input Convert changed');
  }

  return (
    <SatInputConvert
      initialValue={text}
      onChange={onChange}
      label={label}
      name='name'
    />
  );
};
