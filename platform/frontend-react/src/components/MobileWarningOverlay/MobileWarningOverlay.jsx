/* eslint-disable */
import React from 'react';
import './MobileWarningOverlay.css';
import PrimaryButton from "../Buttons/PrimaryButton";
import InfoPanel from "../InfoPanel/InfoPanel";

export default function MobileWarningOverlay({show, handleClick}) {
  return (
    <>
      <div className={show ? "mobile-warning-overlay-container" : "d-none"}>
        <div className="mobile-warning-overlay-header">
          <h1>Warning!<br/>Page Is Not Mobile Friendly.</h1>
        </div>
        <div className="mobile-warning-overlay-body">
          <div className="mobile-warning-overlay-body-text">
            <InfoPanel text={"We recommend you consider using a laptop or desktop computer to utilize LQwD's full potential." +
              "This page is not currently friendly for mobile."} warn={true}/>
          </div>
        </div>
        <div className="mobile-warning-overlay-footer w-100 justify-content-center">
          <PrimaryButton text={"Close"} onClick={handleClick} className={"w-75 p-2"}></PrimaryButton>
        </div>
      </div>
    </>
  );
}