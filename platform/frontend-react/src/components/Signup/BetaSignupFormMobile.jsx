/* eslint-disable */
import React, { useState, useEffect } from 'react';
import Input from "../Basic/Input";
import Password from "../Basic/Password";
import PrimaryButton from "../Buttons/PrimaryButton";
import './SignupFormMobile.css'
import InfoPanel from "../InfoPanel/InfoPanel";
import checkMarkIcon from "../../public/icons/general/svg/Checkmark.svg";
import errorIcon from "../../public/icons/general/svg/ErrorTriangle.svg";
import PasswordChecklist from "react-password-checklist";

const BetaSignupFormMobile = ({numOfSpots, handleRegistration}) => {

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [isDisabled, setIsDisabled] = useState(true);

  const [showValidator, setShowValidator] = useState(false);

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
            Sign Up 1.0
          </div>
        </div>
        {
          numOfSpots == null ?
            <></>
            :
            <>
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
            </>
        }

        <div className="signup-page-form-mobile">
          <div className="signup-page-form-inputs">
            <label className="signup-page-form-label">Email*</label>
            <Input className="signup-page-form-input" type="text" id="email" name="email" onChange={onUserNameChanged}/>
          </div>
          {numOfSpots > 0 ?
            <>
              <div className="signup-page-form-inputs">
                <label className="signup-page-form-label">Password*</label>
                <Password className="" type="password" id="password" name="password"
                          onChange={onPasswordChanged}
                          handleFocus={() => setShowValidator(true)}
                          handleBlur={() => setShowValidator(false)}/>
              </div>
                <PasswordChecklist
                  rules={["minLength","specialChar","number","capital"]}
                  minLength={6}
                  value={password}
                  onChange={(isValid) => {setIsDisabled(isValid)}}
                  style={{
                    position: 'absolute',
                    bottom:'0px',
                    backgroundColor: "#FFF",
                    zIndex: "999",
                    borderRadius: "16px",
                    width: "94%",
                    display: (!showValidator ? "none" : "block")
                  }}
                />
              <div className="signup-page-terms-services justify-content-center">
                By creating an account you agree to our&nbsp; <a href={"/terms-service"}>Terms of Service</a>
              </div>
              <PrimaryButton disabled={!isDisabled} text="Create account" onClick={() => handleRegistration(username, password)}></PrimaryButton>
            </>
            :
            <>
              <div className="signup-page-form-checkbox">
                <input type="checkbox"/>
                <label>Subscribe me to your mailing list*</label>
              </div>
              <div className="signup-page-terms-services justify-content-center">
                By creating an account you agree to our&nbsp; <a href={"/terms-service"}>Terms of Service</a>
              </div>
              <PrimaryButton text="Subscribe"></PrimaryButton>
            </>
          }
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
            <a href={"/privacy-policy"} className="footer-term-links-link-mobile">Privacy Policy</a>
            <a href={"/terms-service"} className="footer-term-links-link-mobile">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BetaSignupFormMobile;