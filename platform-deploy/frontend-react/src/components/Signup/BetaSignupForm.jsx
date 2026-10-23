/* eslint-disable */
import React, { useState, useEffect, useRef } from "react";
import LoginLogo from "../../public/icons/login/LoginLogo.svg";
import Input from "../Basic/Input";
import Password from "../Basic/Password";
import PrimaryButton from "../Buttons/PrimaryButton";
import './SignupForm.css'
import InfoPanel from "../InfoPanel/InfoPanel";
import checkMarkIcon from "../../public/icons/general/svg/Checkmark.svg";
import errorIcon from "../../public/icons/general/svg/ErrorTriangle.svg";
import { Button } from "react-bootstrap";
import NotificationDuration from "../../NotificationDuration";
import { useSnackbar } from "notistack";
import PasswordChecklist from "react-password-checklist";
import { requestSubscribeWaitlist } from "../../requests/Signup";

const BetaSignupForm = ({numOfSpots, handleRegistration}) => {

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showValidator, setShowValidator] = useState(false);
  const { enqueueSnackbar } = useSnackbar();

  const [isDisabled, setIsDisabled] = useState(true);

  const onUserNameChanged = (event) => {
    console.log(event.target.value);
    setUsername(event.target.value);
  };

  const onPasswordChanged = (value) => {
    console.log(value);
    setPassword(value);
  };

  const validatePassword = (value) => {
    console.log(value);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (numOfSpots > 0 && !isDisabled) {
      handleRegistration(username, password);
    }
  };

  const handleSubscribe = (event) => {
    event.preventDefault();
    console.log(username);
    requestSubscribeWaitlist({email: username})
      .then(function(response){
        if(response.status === 200) {
          enqueueSnackbar('Successfully Subscribed', { variant: 'success', autoHideDuration: NotificationDuration });
        }else {
          enqueueSnackbar('Failed to Subscribe', { variant: 'error', autoHideDuration: NotificationDuration });
        }
      }).catch(function(error){
        enqueueSnackbar('Failed to Subscribe', { variant: 'error', autoHideDuration: NotificationDuration });
    });
  };

  return (
    <>
      <img className="signup-page-logo" src={LoginLogo} />
        <div className="signup-page-form-container">
          <div className="signup-page-form-header">
            <div className="signup-page-form-title">
              Sign Up 1.0
            </div>
            <div className="signup-page-form-subtitle d-lg-block d-md-none">
              Welcome! Start today, transact with Bitcoin using the Lightning Network instantly and cheaply.
            </div>
          </div>
          {
            numOfSpots == null ?
              <></>
              :
              <div className="beta-signup-banner">
                {numOfSpots <= 0 ?
                  <InfoPanel
                    warn={true}
                    text={
                      "Sorry, no more Spots available. Join our mailing list and get all the latest news."}
                    imgObj={errorIcon}
                  ></InfoPanel>
                  :
                  <InfoPanel
                    success={true}
                    text={
                      "Only " + numOfSpots + " spots left!"}
                    imgObj={checkMarkIcon}
                  ></InfoPanel>
                }
              </div>
          }

          <form onSubmit={handleSubmit}>
            <div className="signup-page-form">
              <div className="signup-page-form-inputs">
                <label className="signup-page-form-label">Email*</label>
                <Input className="signup-page-form-input" type="text" id="email" name="email" onChange={onUserNameChanged}/>
              </div>
              {numOfSpots > 0 ?
                <>
                  <div className="signup-page-form-inputs">
                    <label className="signup-page-form-label">Password*</label>
                    <Password className="" type="password"
                              id="password"
                              name="password"
                              onChange={onPasswordChanged}
                              handleFocus={() => setShowValidator(true)}
                              handleBlur={() => setShowValidator(false)}/>
                  </div>
                  <div className="signup-page-form-inputs">
                    <label className="signup-page-form-label">Confirm Password*</label>
                    <Password className="" type="password"
                              id="confirmPassword"
                              name="confirmPassword"
                              onChange={(value) => setConfirmPassword(value)}
                              handleFocus={() => setShowValidator(true)}
                              handleBlur={() => setShowValidator(false)}/>
                  </div>
                  <div className="signup-page-terms-services justify-content-center">
                    By creating an account you agree to our&nbsp;<a href={"/terms-service"}>Terms of Service</a>
                  </div>
                  <PrimaryButton disabled={isDisabled} id="register-btn" text="Create account" onClick={() => handleRegistration(username, password)}></PrimaryButton>
                  <span className="signup-page-not-registered">
                    Already have an account? <a className="signup-page-create-account-link" href={"/"}>Log in here</a>
                  </span>
                  <div className="">
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
                </>
                :
                <>
                  <div className="signup-page-form-checkbox">
                    <input type="checkbox"/>
                    <label>Subscribe me to your mailing list*</label>
                  </div>
                  <PrimaryButton text="Subscribe" onClick={handleSubscribe}></PrimaryButton>
                  <span className="signup-page-not-registered">
                    Already have an account? <a className="signup-page-create-account-link" href={"/"}>Log in here</a>
                  </span>
                </>
              }

            </div>
            <Button className="d-none" type="submit"></Button>
          </form>
          <div className="signup-page-form-footer">
            <div className="signup-page-form-footer-row">
              Having issues? Email us at <a className="signup-page-create-account-link" href={"mailto:feedback@lqwd.money"}> feedback@lqwd.money</a>
            </div>
            <div className="signup-page-form-footer-rights-line">
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

export default BetaSignupForm;