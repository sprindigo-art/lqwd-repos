import React from 'react';
import { BrowserRouter as Router, useRoutes } from 'react-router-dom';
import SideNavElement from './SideNavElement';
import dashboardImg from '../../public/icons/sidenav/Dashboard.png';
import { navbarList } from './SideNavContainer'

export default {
  title: 'Navigation/SideNavItem',
  component: SideNavElement,
  argTypes: {
    backgroundColor: { control: 'color' },
  },
};

const Template = (args) => {
  let { styles, ...params } = args;
  return (
    <div style={args.styles}>
      <Router>
        <SideNavElement {...params} {...navbarList[0]} />
      </Router>
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
