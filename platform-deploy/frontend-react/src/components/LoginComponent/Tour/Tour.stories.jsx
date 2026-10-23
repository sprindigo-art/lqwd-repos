import React from 'react';
import Tour from './Tour';
import { useArgs } from '@storybook/client-api';

export default {
  title: 'Lqwd Login/Tour',
  component: Tour,
  args: {
    isOpen: false,
  }
};



export const primary = ({...args}) => {

  const [{ isOpen }, updateArgs] = useArgs();

  let show = true;

  const onClose = () => {
    console.log('closed');
    updateArgs({ isOpen: !isOpen })
  }

  return (
    <div>
      <button onClick={() => updateArgs({ isOpen: !isOpen })}> show </button>
      <Tour
        handleHide={onClose}
        show={isOpen}
        onClose={onClose}
      />

    </div>
  );
};
