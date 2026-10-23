/* eslint-disable */
import "./TermsContainer.css";
import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Moment from "moment";
import lqwdLogo from '../../public/icons/header/LQwD-Logo@4x.png';
import { parseHTML } from "jquery";

export default function TermsContainer({title, date, json, mobile}) {

  const navigate = useNavigate();

  return (
    <>
      {
        mobile ?
          <div className="terms-container">
            <div className="terms-container-header">
              <div className="terms-container-logo" onClick={() => navigate("/login")} style={{cursor: "pointer"}}>
                <img src={lqwdLogo} width={"115px"} height={"40px"}/>
              </div>
            </div>
            <div className="terms-container-row">
              <div className="terms-container-col">
                <div className="terms-container-title">
                  {title}
                </div>
                <div className="terms-container-subtitle">
                  Last updated: {Moment(date).format('MMM, DD YYYY')}
                </div>
              </div>
              <div className="terms-container-col-text">
                <div className="terms-container-value">
                  {
                    json.map((items) => (
                      <>
                        {items.header !== "" ? <div className="terms-container-col-header">{items.header}</div> : <></>}
                        {items.subheader !== "" ? <div className="terms-container-col-subheader">{items.subheader}</div> : <></>}
                        <div className="terms-container-col-inner-text" dangerouslySetInnerHTML={ { __html: items.text } }></div>
                      </>
                    ))

                  }
                </div>
              </div>
            </div>
          </div>
          :
          <div className="terms-container-mobile">
            <div className="terms-container-header-mobile">
              <div className="terms-container-logo-mobile">
                <img src={lqwdLogo} width={"93px"} height={"32px"}/>
              </div>
            </div>
            <div className="terms-container-row-mobile">
              <div className="terms-container-col-mobile">
                <div className="terms-container-title-mobile">
                  {title}
                </div>
                <div className="terms-container-subtitle-mobile">
                  Last updated: {Moment(date).format('MMM, DD YYYY')}
                </div>
              </div>
              <div className="terms-container-col-text-mobile">
                <div className="terms-container-value-mobile">
                  {
                    json.map((items) => (
                      <>
                        {items.header !== "" ? <div className="terms-container-col-header-mobile">{items.header}</div> : <></>}
                        {items.subheader !== "" ? <div className="terms-container-col-subheader-mobile">{items.subheader}</div> : <></>}
                        <div className="terms-container-col-inner-text-mobile" dangerouslySetInnerHTML={ { __html: items.text } }></div>
                      </>
                    ))

                  }
                </div>
              </div>
            </div>
          </div>
      }
    </>
  );
}