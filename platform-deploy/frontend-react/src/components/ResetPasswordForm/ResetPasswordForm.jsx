/* eslint-disable */
import React, { useState } from 'react';
import './ResetPasswordForm.sass';
import '../LoginComponent/LoginForm/LoginForm.css'
import LoginLogo from '../../public/icons/login/LoginLogo.svg';
import Input from '../Basic/Input'
import backImage from '../../public/icons/general/svg/Back2.svg';
import PrimaryButton from '../Buttons/PrimaryButton';

export default function ResetPasswordPage({ onPasswordResetClick, goback }) {

    const [email, setEmail] = useState('');

    const onEmailChanged = (event) => {
        console.log(event.target.value);
        setEmail(event.target.value);
    };

    return (
        <div>
            <img className="login-page-logo" src={LoginLogo} onClick={goback} style={{cursor: "pointer"}}/>
            <div className="login-page-form-container">
                <div className="login-page-form-header">
                    <div className="login-page-form-title">
                        <div>
                            <span>Reset password</span>
                        </div>
                    </div>
                    <div className="login-page-form-subtitle">
                        Enter the email address associated with your account, and we will send you instructions to reset your password.
                    </div>
                </div>
                <div className="login-page-form">
                    <div className="login-page-form-inputs">
                        <label className="login-page-form-label">Email*</label>
                        <Input className="login-page-form-input" type="text" id="email" name="email" onChange={onEmailChanged} />
                    </div>
                    <div className="d-flex flex-column">
                        <PrimaryButton text="Send reset instructions" onClick={() => onPasswordResetClick( email )}></PrimaryButton>
                    </div>
                </div>

                <div className="login-page-form-footer">
                    <div className="login-page-form-footer-rights-line">
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
    );
}
