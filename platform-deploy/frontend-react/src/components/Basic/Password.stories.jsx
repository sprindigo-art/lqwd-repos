import React from 'react';
import Password from './Password';

export default {
  title: 'Lqwd Basic/Password Input',
  component: Password,
};

export const primary = () => {
  const text = 'pass'
  return (
    <Password
    initialValue={text}
    />
  );
};

export const largePassword = () => {
  const text = 'this is very important password which is very very very long due to security. soooooooooooooooooooooooooooooooooooooo long'
  return (
    <Password
    initialValue={text}
    />
  );
};

export const withError = () => {
  const text = 'pass'
  return (
    <Password
    initialValue={text}
      errorMsg= "wrong Password"
      error={true}
    />
  );
};

