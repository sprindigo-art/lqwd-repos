import React from 'react';

import Header from './Header';

export default {
  title: 'Navigation/Header',
  component: Header,
  argTypes: {
    backgroundColor: { control: 'color' },
  },
};

const Template = (args) => {
  let {styles, ...params} = args;
  return (
    <div style={args.styles}>
      <Header {...params} />
    </div>
  )
};

export const Primary = Template.bind({});
Primary.args = {
  primary: true,
  label: 'Button2',
  styles: {
    color: 'blue',
    border: 'solid 1px red',
    width: '100%',
    height: '50px'
  }
};

export const Secondary = Template.bind({});
Secondary.args = {
  label: 'Button',
  styles: {
    color: 'black',
    border: 'solid 1px red',
    width: '300px'
  }
};

export const Large = Template.bind({});
Large.args = {
  size: 'large',
  label: 'Button',
  styles: {
    color: 'blue',
    border: 'solid 1px red',
    width: '400px'
  }
};

export const Small = Template.bind({});
Small.args = {
  size: 'small',
  label: 'Button',
  styles: {
    color: 'blue',
    border: 'solid 1px red',
    width: '200px'
  }
};
