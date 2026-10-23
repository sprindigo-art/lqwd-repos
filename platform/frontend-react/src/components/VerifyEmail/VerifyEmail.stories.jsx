import React from 'react';
import VerifyEmail from './VerifyEmail.jsx';
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";

export default {
  title: 'LQWD Signup/Verify Email',
  component: VerifyEmail,
};

export const primary = () => {
  return (
    <div>
      <LoginLayout children={
        <VerifyEmail email={"example@example.com"}/>
      }></LoginLayout>

    </div>
  );
};