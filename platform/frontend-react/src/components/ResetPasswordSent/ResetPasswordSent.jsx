/* eslint-disable */
import React, { useState } from 'react';
import './ResetPasswordSent.sass';
import '../LoginComponent/LoginForm/LoginForm.css'
import LoginLogo from '../../public/icons/login/LoginLogo.svg';
import resetPasswordSent from '../../public/icons/login/resetPasswordSent.svg';

export default function ResetPasswordSent({userEmail, handleClick}) {

    return (
        <div>
            <img className="login-page-logo" src={LoginLogo} />
            <div className="login-page-form-container">
                <div className="login-page-form-header">
                    <div className="pb-2 login-page-resend-password-icon">
                        <img src={resetPasswordSent} />
                    </div>
                    <div className="login-page-form-title">
                        <div>
                            <span>Check your email</span>
                        </div>
                    </div>
                    <div className="login-page-form-subtitle">
                        {`We have sent a password reset instructions to ${userEmail}. The password reset link is valid for 1 hour.`}
                    </div>
                    <span className="login-page-not-registered">
                        Didn’t receive the email?
                        <a onClick={handleClick} className="login-page-resend-password-link" >
                            Click to resend
                        </a>

                    </span>

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
