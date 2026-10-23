/* eslint-disable */
import React from 'react';
import RadioButton from "./RadioButton";
import { useArgs } from '@storybook/client-api';

export default {
  title: 'LQWD Basic/ Radio Button',
  component: RadioButton,
  args: {
    selected: [true, false, false, false],
  }
};

export const primary = ({...args}) => {
  const [{ selected }, updateArgs] = useArgs();

  const handleChange = (value) => {
    let newVal = Array(4).fill(false);
    newVal[value.target.id] = true;
    updateArgs({ selected: newVal })
  }

  return (
    <div>
      <RadioButton handleChange={handleChange} selected={selected[0]} label={"Example Radio Button"} value={"example"} id={0} name={"example1"}></RadioButton>
      <RadioButton handleChange={handleChange} selected={selected[1]} label={"Example Radio Button"} value={"example"} id={1} name={"example2"}></RadioButton>
      <RadioButton handleChange={handleChange} selected={selected[2]} label={"Example Radio Button"} value={"example"} id={2} name={"example3"}></RadioButton>
      <RadioButton handleChange={handleChange} selected={selected[3]} label={"Example Radio Button"} value={"example"} id={3} name={"example4"}></RadioButton>
    </div>
  )
}

export const selected = () => {

  return (
    <div>
      <RadioButton selected={true} label={"Example Radio Button"} value={"example"} id={"example1"} name={"example1"}></RadioButton>
    </div>
  )
}

export const notSelected = () => {

  return (
    <div>
      <RadioButton selected={false} label={"Example Radio Button"} value={"example"} id={"example1"} name={"example1"}></RadioButton>
    </div>
  )
}