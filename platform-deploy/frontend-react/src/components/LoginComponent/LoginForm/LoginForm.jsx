/* eslint-disable */
import React from 'react';
import './LoginForm.css';
import LoginLogo from '../../../public/icons/login/LoginLogo.svg';
import Input from '../../Basic/Input'
import Password from '../../Basic/Password'
import PrimaryButton from '../../Buttons/PrimaryButton';
import { useState } from "react";
import { Button } from "react-bootstrap";


export default function LoginForm({onLoginClick}) {

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

    const handleSubmit = (event) => {
        event.preventDefault();
        console.log(username, password);
        onLoginClick({ username, password });
    };

    return (
      <>
        <img className="login-page-logo" src={LoginLogo} />
        <div className="login-page-form-container">
            <div className="login-page-form-header">
                <div className="login-page-form-title">Login</div>
                <div className="login-page-form-subtitle">
                    Welcome back! Please enter your details to access your account.
                </div>
            </div>
            <form onSubmit={handleSubmit}>
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
                        <a className="flex-column forgot-password-link" href={"/reset-password"}>Forgot Password?</a>
                    </div>
                    <div className="d-flex flex-column">
                        <PrimaryButton disabled={disabledLogin} text={disabledLogin ? "Enter Password" : "Login"} onClick={() => onLoginClick({username, password})}></PrimaryButton>
                        <span className="login-page-not-registered">
                        Not registered yet? <a className="login-page-create-account-link" href={"/signup"}> Create an Account</a>
                        </span>
                    </div>
                </div>
                <Button className={"d-none"} type="submit"></Button>
            </form>
            <div className="login-page-form-footer">
              <div className="login-page-form-footer-row">
                  Having issues? Email us at
                  <a className="login-page-create-account-link" href={"mailto:feedback@lqwd.money"}>
                      feedback@lqwd.money
                  </a>
              </div>
              <div className="login-page-form-footer-rights-line">
                  © 2022 All Rights Reserved. LQwD FinTech Corp.
              </div>
                <div className="footer-term-links">
                  <a href={"/privacy-policy"} className="footer-term-links-link">Privacy Policy</a>
                  <a href={"/terms-service"} className="footer-term-links-link">Terms of Service</a>
                </div>
            </div>
        </div>
    </>
    );
}
