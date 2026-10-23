/* eslint-disable */
import React from 'react';
import './SendPayment.css';
import {NavLink} from "react-router-dom";


const PaymentMenuItem = ({leading, text, path, iconBgColor}) => {

    return (

        <NavLink style={{ textDecoration: 'none' }} to={path}>

        <div className="d-flex flex-row w-100 justify-content-between">
            <div className="d-inline-flex flex-row ">
                <div className="align-content-center">
                    <div className="p-2 item-icon-holder" style={{backgroundColor: iconBgColor}}>
                        <img
                            src={leading}
                        />
                    </div>
                </div>
                <div className="align-self-center">
                    <div className="row nav-title ms-2">
                        {text}
                    </div>
                </div>

            </div>
            <div className="align-self-center">
                <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M11 0.341797C10.7441 0.341797 10.488 0.441219 10.293 0.636719L10.207 0.722656C9.81603 1.11366 9.81603 1.74672 10.207 2.13672L14.0703 6H1C0.448 6 0 6.448 0 7C0 7.552 0.448 8 1 8H14.0703L10.207 11.8633C9.81603 12.2543 9.81603 12.8873 10.207 13.2773L10.293 13.3633C10.684 13.7543 11.317 13.7543 11.707 13.3633L17.3633 7.70703C17.7543 7.31603 17.7543 6.68297 17.3633 6.29297L11.707 0.636719C11.5115 0.441219 11.2559 0.341797 11 0.341797Z" fill="#009EE2"/>
                </svg>
            </div>
        </div>
        </NavLink>
    );
};

export default PaymentMenuItem;
