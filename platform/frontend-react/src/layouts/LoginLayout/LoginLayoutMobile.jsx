/* eslint-disable */
import React from 'react';
import './LoginLayoutMobile.css';
import lqwdLogoMobile from "../../public/icons/login/LQwD-Logo@4x.svg";
import Balance from "../../components/NodeBalance/Balance";
import { useNavigate } from "react-router-dom";


export default function LoginLayoutMobile({ children }) {
  const navigate = useNavigate();

  return (
    <div className='mobile-login-layout' >
      <div className='background'>
        <div className="mobile-logo" onClick={() => navigate("/")}>
          <img src={lqwdLogoMobile}/>
        </div>

        <div className='background-panel'>

          <Balance currency={{
            code: 'sats',
            name: 'Satoshis',
            rate: 1,
          }} balanceHistory={[]} sent={346000.00} received={832400.00} balance={0} />

          <div className="shape shape-1"> </div>
          <div className="shape shape-2"> </div>
          <div className="shape shape-3"> </div>
          <div className="shape shape-4"> </div>

          <div className="square-left top"></div>
          <div className="square-right top"></div>
          <div className="square-right bottom"></div>
          <div className="square-left bottom"></div>

          <div className="line line-1"></div>
          <div className="line line-3"></div>

          <div className="line line-2"></div>
          <div className="line line-4"></div>

          <div className="welcome-text">
            <div className="welcome-text-header center">
                Lightning Network Infrastructure For Global Scale
            </div>
            <div className="welcome-text-subheader">
              Usable anywhere in the world.
            </div>
          </div>
        </div>

      </div>
      <div className='input-panel'>
        {children}
      </div>
    </div>
  );
}