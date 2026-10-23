import React from 'react';
import { BrowserRouter as Router, useRoutes } from 'react-router-dom';
import SideNav from './SideNav';
import { navbarList } from './SideNavContainer'


export default {
  title: 'Navigation/SideNav',
  component: SideNav,
  argTypes: {
    backgroundColor: { control: 'color' },
  },
};

const Template = (args) => {
  let {styles, ...params} = args;
  return (
    <div style={args.styles}>
      <Router>
        <SideNav {...params} navbarList={navbarList} />
      </Router>
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
    width: '300px'
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
