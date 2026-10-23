/* eslint-disable */
import React from 'react';
import './LoginFormMobile.css';
import Input from '../../Basic/Input'
import Password from '../../Basic/Password'
import PrimaryButton from '../../Buttons/PrimaryButton';
import { useState } from "react";


export default function LoginFormMobile({onLoginClick}) {

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [disabledLogin, setDisableLogin] = useState(true);

  const onUserNameChanged = (event) => {
    console.log(event.target.value);
    setUsername(event.target.value);
  };

  const onPasswordChanged = (value) => {
    console.log(value);
    setPassword(value);
    if (value.length > 5){
     setDisableLogin(false);
    }else{
      setDisableLogin(true);
    }
  };


  return (
    <div className="login-page-container-mobile">
      <div className="login-page-form-title">
        Login
      </div>
      <div className="login-page-form">
        <div className="login-page-form-inputs">
          <label className="login-page-form-label">Email*</label>
          <Input className="login-page-form-input" type="text" id="email" name="email" onChange={onUserNameChanged}/>
        </div>
        <div className="login-page-form-inputs">
          <label className="login-page-form-label">Password*</label>
          <Password className="login-page-password-input" autoComplete={"current-password"} type="password" id="password" name="password" onChange={onPasswordChanged}/>
        </div>
        <div className="d-flex flex-row justify-content-between">
          <div className="login-page-form-checkbox">
            <input type="checkbox"/>
            <label>Remember Me</label>
          </div>
          <div className="d-flex flex-column">
            <a className="flex-column forgot-password-link" href={"/reset-password"}>Forgot Password?</a>
          </div>
        </div>
        <PrimaryButton disabled={disabledLogin} text={disabledLogin ? "Enter Password" : "Login"} onClick={() => onLoginClick({username, password})}></PrimaryButton>
        <span className="login-page-not-registered-mobile">Not registered yet?
          <a className="login-page-create-account-link" href={"/signup"}> Create an Account</a>
        </span>
      </div>

      <div className="login-page-form-footer-mobile">
        <div className="login-page-form-footer-row-mobile">
          Having issues? Email us at <a className="login-page-create-account-link" href={"mailto:feedback@lqwd.money"}> feedback@lqwd.money</a>
        </div>
        <div className="login-page-form-footer-rights-line">
          © 2022 All Rights Reserved. LQwD FinTech Corp.
        </div>
        <div className="footer-term-links-mobile">
          <a href={"/privacy-policy"} className="footer-term-links-link-mobile">Privacy Policy</a>
          <a href={"/terms-service"} className="footer-term-links-link-mobile">Terms of Service</a>
        </div>
      </div>
    </div>
  );
}
