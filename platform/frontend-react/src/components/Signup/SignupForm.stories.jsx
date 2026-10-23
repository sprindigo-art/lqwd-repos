/* eslint-disable */
import React from 'react';
import SignupForm from './SignupForm';
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import BetaSignupForm from "./BetaSignupForm";

export default {
  title: 'Lqwd Signup/Signup Form',
  component: SignupForm,
};



export const primary = () => {
  return (
    <div style={{width: "100%", height: "100vh"}}>
      <SignupForm/>
    </div>
  );
};

export const betaSignup = () => {
  return (
    <div style={{width: "100%", height: "100vh"}}>
      <BetaSignupForm numOfSpots={0}/>
    </div>
  );
};