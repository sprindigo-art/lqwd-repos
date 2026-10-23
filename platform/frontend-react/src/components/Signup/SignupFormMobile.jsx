/* eslint-disable */
import React, { useState, useEffect } from 'react';
import LoginLogo from "../../public/icons/login/LoginLogo.svg";
import Input from "../Basic/Input";
import Password from "../Basic/Password";
import PrimaryButton from "../Buttons/PrimaryButton";
import './SignupForm.css'
import InfoPanel from "../InfoPanel/InfoPanel";
import errorIcon from "../../public/icons/general/svg/ErrorTriangle.svg";
import checkMarkIcon from "../../public/icons/general/svg/Checkmark.svg";


const SignupFormMobile = () => {

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
    <div className="signup-page-container-mobile">
      <div className="signup-page-form-container-mobile">
        <div className="signup-page-form-header-mobile">
          <div className="signup-page-form-title-mobile">
            Sign up
          </div>
        </div>

        <div className="signup-page-form-mobile">
          <div className="signup-page-form-inputs">
            <label className="signup-page-form-label">Email*</label>
            <Input className="signup-page-form-input" type="text" id="email" name="email" onChange={onUserNameChanged}/>
          </div>

          <div className="signup-page-form-inputs">
            <label className="signup-page-form-label">Password*</label>
            <Password className="" type="password" id="password" name="password" onChange={onPasswordChanged} />
          </div>
          <PrimaryButton text="Create account" onClick={() => handleRegistration(username, password)}></PrimaryButton>

          <span className="signup-page-not-registered-mobile">
            Already have an account?
            <a className="signup-page-create-account-link-mobile" href={"/"}>
              Log in here
            </a>
          </span>
        </div>
        <div className="signup-page-form-footer-mobile">
          <div className="signup-page-form-footer-row-mobile">
            Having issues? Email us at <a className="signup-page-create-account-link-mobile" href={"mailto:feedback@lqwd.money"}> feedback@lqwd.money</a>
          </div>
          <div className="signup-page-form-footer-rights-line-mobile">
            © 2022 All Rights Reserved. LQwD FinTech Corp.
          </div>
          <div className="footer-term-links-mobile">
            <a className="footer-term-links-link-mobile">Cookie Preferences</a>
            <a className="footer-term-links-link-mobile">Privacy</a>
            <a className="footer-term-links-link-mobile">Terms</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignupFormMobile;