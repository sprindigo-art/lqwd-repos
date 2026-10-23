/*eslint-disable*/
import React from "react";
import LoginLogo from "../../public/icons/login/LoginLogo.svg";
import VerifyEmailIcon from "../../public/icons/login/VerifyEmailIcon.svg";
import VerifiedEmailIcon from "../../public/icons/login/VerifiedEmailIcon.svg";
import "./VerifyEmail.css";
import closeImage from "../../public/icons/general/svg/Close.svg";
import PrimaryButton from "../Buttons/PrimaryButton";
import { useNavigate } from "react-router-dom";

export default function VerifyEmail({email, isMobile, onClose, handleClick, isVerified}) {

  const navigate = useNavigate();

  const redirectToLogin = () => {
    navigate("/login");
  };
  return (
    <>
      {isMobile ?
        <>
          <div className="verify-email-close-icon-mobile" onClick={onClose}>
            <img src={closeImage}/>
          </div>
          <div className="verify-email-container-mobile justify-content-center">
            {isVerified ?
              <div className="verify-email-subcontainer-mobile">

                <div className="row justify-content-center">
                  <img className="verify-email-icon-mobile" src={VerifiedEmailIcon} />
                  <div className="verify-email-header-mobile justify-content-center">Email Verified!</div>
                  <PrimaryButton text={"Log in to LQwD"} onClick={() => redirectToLogin()}></PrimaryButton>

                </div>
              </div>
              :
              <div className="verify-email-subcontainer-mobile">

                <div className="row justify-content-center">
                  <img className="verify-email-icon-mobile" src={VerifyEmailIcon} />
                  <div className="verify-email-header-mobile">Verify your email</div>
                  <div className="verify-email-subheader-mobile">
                    {"We have sent you a verification link to " + email + "." +
                      " Please check your email and verify it to complete the registration"}
                  </div>

                  <div className="verify-email-resend-mobile">
                    Didn't receive the email?
                    <a className="verify-email-resent-link" onClick={handleClick}>Click to resend</a>
                  </div>
                </div>
              </div>
            }
            <div className="verify-email-footer-mobile">
              <div className="verify-email-footer-row-mobile">
                Having issues? Email us at
                <a className="verify-email-footer-feedback-link-mobile" href={"mailto:feedback@lqwd.money"}>
                  feedback@lqwd.money
                </a>
              </div>
              <div className="verify-email-footer-rights-line-mobile">
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
        <div className="verify-email-container">

          <img className="verify-email-logo" src={LoginLogo} />

          {
            isVerified ?
              <div className="row verify-email-subcontainer">

                <img className="row verify-email-icon" src={VerifiedEmailIcon} />

                <div className="verify-email-header justify-content-center">Email Verified!</div>
                <PrimaryButton text={"Log in to LQwD"} onClick={() => redirectToLogin()}></PrimaryButton>
              </div>

              :

              <div className="row verify-email-subcontainer">

                <img className="row verify-email-icon" src={VerifyEmailIcon} />

                <div className="verify-email-header">Verify your email</div>
                <div className="verify-email-subheader">
                  {"We have sent you a verification link to " + email+"." +
                    " Please check your email and verify it to complete the registration"}
                </div>

                <div className="verify-email-resend">
                  Didn't receive the email?
                  <a className="verify-email-resent-link" onClick={handleClick}>Click to resend</a>
                </div>
              </div>
          }


          <div className="verify-email-footer">
            <div className="verify-email-footer-row">
              Having issues? Email us at
              <a className="verify-email-footer-feedback-link" href={"mailto:feedback@lqwd.money"}>
                feedback@lqwd.money
              </a>
            </div>
            <div className="verify-email-footer-rights-line">
              © 2022 All Rights Reserved. LQwD FinTech Corp.
            </div>
            <div className="footer-term-links">
              <a className="footer-term-links-link">Cookie Preferences</a>
              <a className="footer-term-links-link">Privacy</a>
              <a className="footer-term-links-link">Terms</a>
            </div>
          </div>

        </div>
      }
    </>
  );
}
