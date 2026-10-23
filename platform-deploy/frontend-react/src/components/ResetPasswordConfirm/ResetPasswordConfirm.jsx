/* eslint-disable */
import React, { useEffect, useState } from "react";
import './ResetPasswordConfirm.css';
import LoginLogo from "../../public/icons/login/LoginLogo.svg";
import PrimaryButton from "../Buttons/PrimaryButton";
import Password from "../Basic/Password";
import Input from "../Basic/Input";
import { Button } from "react-bootstrap";
import PasswordChecklist from "react-password-checklist";
import { useNavigate } from "react-router-dom";

export default function ResetPasswordConfirm({ handleConfirmPassword, mobile }) {

  const navigate = useNavigate();

  const [password, setPassword] = useState('');

  const [confirmPassword, setConfirmPassword] = useState('');

  const [match, setMatch] = useState(true);

  const [isDisabled, setIsDisabled] = useState(true);
  const [showValidator, setShowValidator] = useState(false);

  const onPasswordChange = (value) => {
    setPassword(value);
  };

  const checkPasswordMatch = (value) => {
    setConfirmPassword(value);
    if (value === password){
      setMatch(true);
    }else{
      setMatch(false);
    }

  };

  const handleSubmit = (event) => {
    event.preventDefault();
    handleConfirmPassword(password);
  }

  return (
    <>
      {mobile ?
        <>
          <div className="login-page-container-mobile">
            <div className="login-page-form-title">
              Reset Password
            </div>
            <form onSubmit={handleSubmit}>
              <div className="login-page-form">
                <div className="login-page-form-inputs">
                  <label className="login-page-form-label">Password</label>
                  <Password className="login-page-password-input"
                            handleFocus={() => setShowValidator(true)}
                            handleBlur={() => setShowValidator(false)}
                            onChange={onPasswordChange}/>
                </div>
                <div className="login-page-form-inputs">
                  <label className="login-page-form-label">Confirm Password</label>
                  <Password className="login-page-password-input"
                            onChange={checkPasswordMatch}
                            handleFocus={() => setShowValidator(true)}
                            handleBlur={() => setShowValidator(false)}/>
                </div>
                <PrimaryButton text="Reset Password" onClick={() => handleConfirmPassword(password)} disabled={isDisabled}></PrimaryButton>
                <PasswordChecklist
                  rules={["minLength","specialChar","number","capital", "match"]}
                  minLength={6}
                  value={password}
                  valueAgain={confirmPassword}
                  onChange={(isValid) => {setIsDisabled(!isValid);}}
                  style={{
                    position: 'relative',
                    backgroundColor: "#FFF",
                    zIndex: "999",
                    borderRadius: "16px",
                    display: (!showValidator ? "none" : "block")
                  }}
                />
              </div>
              <Button className={"d-none"} type="submit"></Button>
            </form>

            <div className="login-page-form-footer-mobile">
              <div className="login-page-form-footer-row-mobile">
                Having issues? Email us at <a className="login-page-create-account-link" href={"mailto:feedback@lqwd.money"}> feedback@lqwd.money</a>
              </div>
              <div className="login-page-form-footer-rights-line">
                © 2022 All Rights Reserved. LQwD FinTech Corp.
              </div>
              <div className="footer-term-links-mobile">
                <a className="footer-term-links-link-mobile">Cookie Preferences</a>
                <a className="footer-term-links-link-mobile">Privacy</a>
                <a className="footer-term-links-link-mobile">Terms</a>
              </div>
            </div>
          </div>
        </>
        :
        <>
          <img className="login-page-logo" src={LoginLogo} onClick={() => navigate("/")}/>
          <div className="login-page-form-container">
            <div className="login-page-form-header">
              <div className="login-page-form-title">
                <div>
                  <span>Reset Password</span>
                </div>
              </div>
              <div className="login-page-form-subtitle">
                Your new password must be different from the previous used password.
              </div>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="login-page-form">
                <div className="login-page-form-inputs">
                  <label className="login-page-form-label">New password</label>
                  <Password handleFocus={() => setShowValidator(true)}
                            handleBlur={() => setShowValidator(false)}
                            onChange={onPasswordChange}/>

                </div>
                <div className="login-page-form-inputs">
                  <label className="login-page-form-label">Confirm new password</label>
                  <Password onChange={checkPasswordMatch}
                            handleFocus={() => setShowValidator(true)}
                            handleBlur={() => setShowValidator(false)}/>
                </div>
                <div className="d-flex flex-column">
                  <PrimaryButton text="Reset password" onClick={() => handleConfirmPassword(password)} disabled={isDisabled}></PrimaryButton>
                </div>
                <PasswordChecklist
                  rules={["minLength","specialChar","number","capital", "match"]}
                  minLength={6}
                  value={password}
                  valueAgain={confirmPassword}
                  onChange={(isValid) => {setIsDisabled(!isValid);}}
                  style={{
                    position: 'relative',
                    backgroundColor: "#FFF",
                    zIndex: "999",
                    borderRadius: "16px",
                    display: (!showValidator ? "none" : "block")
                  }}
                />
              </div>
              <Button className={"d-none"} type="submit"></Button>
            </form>

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
        </>
      }
    </>
  );
}
