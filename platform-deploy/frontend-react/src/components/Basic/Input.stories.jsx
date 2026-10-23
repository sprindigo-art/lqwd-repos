import React from 'react';
import Input from './Input';

export default {
  title: 'Lqwd Basic/Input',
  component: Input,
};

export const primary = () => {
  const text = 'some text'
  return (
    <Input
      initialValue={text}
    />
  );
};

export const primaryWithLabel = () => {
  const text = 'some text'
  const label = 'Alias'
  return (
    <Input
      initialValue={text}
      label={label}
    />
  );
};

export const largePassword = () => {
  const text = 'this is very long text which is very very very long. soooooooooooooooooooooooooooooooooooooo long'
  return (
    <Input
      initialValue={text}
    />
  );
};

export const withError = () => {
  const text = 'text with error'
  return (
    <Input
      initialValue={text}
      errorMsg="wrong Password"
      error={true}
    />
  );
};

