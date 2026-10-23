/* eslint-disable */
import React, { useState, useEffect } from 'react';
import LoginLogo from "../../public/icons/login/LoginLogo.svg";
import Input from "../Basic/Input";
import Password from "../Basic/Password";
import PrimaryButton from "../Buttons/PrimaryButton";
import './SignupForm.css'


const SignupForm = () => {

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const onUserNameChanged = (event) => {
    console.log(event.target.value);
    setUsername(event.target.value);
  };

  const onPasswordChanged = (value) => {
    console.log(value);
    setPassword(value);
  };

  return (
    <div className="signup-page-container">
      <div className="signup-page-container-row">
        <div className="col-12">
          <img className="signup-page-logo" src={LoginLogo} />
        </div>
    </div>
      <div className="signup-page-container-row h-100">
        <div className="col-12">
          <div className="signup-page-form-container">
            <div className="signup-page-form-header">
              <div className="signup-page-form-title">
                Sign Up
              </div>
              <div className="signup-page-form-subtitle">
                Welcome! Start today, transact with Bitcoin using the Lightning Network instantly and cheaply.
              </div>
            </div>
            <div className="signup-page-form">
              <div className="signup-page-form-inputs">
                <label className="signup-page-form-label">Email*</label>
                <Input className="signup-page-form-input" type="text" id="email" name="email" onChange={onUserNameChanged}/>
              </div>
              <div className="signup-page-form-inputs">
                <label className="signup-page-form-label">Password*</label>
                <Password className="" type="password" id="password" name="password" onChange={onPasswordChanged}/>
              </div>
              <PrimaryButton text="Create account"></PrimaryButton>
              <span className="signup-page-not-registered">
                Already have an account?
                <a className="signup-page-create-account-link" href={"/"}>
                  Log in here
                </a>
              </span>
            </div>
            <div className="signup-page-form-footer">
              <div className="signup-page-form-footer-row">
                Having issues? Email us at <a className="signup-page-create-account-link" href={"mailto:feedback@lqwd.money"}> feedback@lqwd.money</a>
              </div>
              <div className="signup-page-form-footer-rights-line">
                © 2022 All Rights Reserved. LQwD FinTech Corp.
              </div>
              <div className="footer-term-links">
                <a className="footer-term-links-link">Cookie Preferences</a>
                <a className="footer-term-links-link">Privacy</a>
                <a className="footer-term-links-link">Terms</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignupForm;