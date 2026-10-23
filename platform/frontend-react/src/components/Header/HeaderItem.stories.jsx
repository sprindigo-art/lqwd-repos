import React from 'react';

import HeaderItem from './HeaderItem';
import dashboardImg from '../../public/icons/sidenav/Dashboard.png';

export default {
  title: 'Navigation/HeaderItem',
  component: HeaderItem,
  argTypes: {
    backgroundColor: { control: 'color' },
  },
};

const Template = (args) => {
  let {styles, ...params} = args;
  return (
    <div style={args.styles}>
      <HeaderItem {...params} />
    </div>
  )
};

export const Primary = Template.bind({});
Primary.args = {
  primary: true,
  src: dashboardImg,
  title: "Dashboard",
  active: false,
  label: 'Button2',
  styles: {
    color: 'blue',
    border: 'solid 1px red',
    width: '300px'
  }
};

export const Secondary = Template.bind({});
Secondary.args = {
  label: 'Button',
  src: dashboardImg,
  title: "Dashboard",
  active: true,
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
