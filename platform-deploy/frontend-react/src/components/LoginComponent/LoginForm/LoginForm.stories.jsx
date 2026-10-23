import React from 'react';
import LoginForm from './LoginForm';
import { useArgs } from '@storybook/client-api';

export default {
  title: 'Lqwd Login/Login Form',
  component: LoginForm,
};

export const primary = () => {

  return (
    <div style={{width: "100%", height: "100vh"}}>
      <LoginForm/>
    </div>
  );
};
