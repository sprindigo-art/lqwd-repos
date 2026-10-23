/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './ConfirmMfa.css';
import PrimaryButton from '../../Buttons/PrimaryButton';
import imageSrc from '../../../public/icons/login/mfa.svg';
import OtpInput from 'react-otp-input';
import closeImage from '../../../public/icons/general/svg/Close.svg';
import BackImg from "../../../public/icons/general/png/Back.png";
import PrimaryOutlineButton from "../../Buttons/PrimaryOutline";
import { Button } from "react-bootstrap";


export default function ConfirmMfa({ style, show, onActivate, error, activateMode, onClose, goBack, mobile}) {

    const [result, setResult] = useState('');

    const [isFull, setIsFull] = useState(false);

    const handleOnChange = (res) => {
        console.log('changed to ' + res);
        console.log(res.length);
        setResult(res);
        if (res.length === 6){
            setIsFull(true);
        }else{
            setIsFull(false);
        }
    };

    const handleOnSubmit = (event) => {
        event.preventDefault();
        if (result.length === 6){
           onActivate(result);
        }
    };

    useEffect(() => {
        // const keyDownHandler = event => {
        //     if (event.key === 'Enter') {
        //         event.preventDefault();
        //         // myFunction(result, isFull);
        //     }
        // };
        // document.addEventListener('keypress', keyDownHandler);
        //
        // return () => {
        //     document.removeEventListener('keypress', keyDownHandler);
        // };

    }, []);

    return (
      <>
        {
          mobile ?
            <div className={show ? "confirm-mfa" : "d-none"} style={style}>

              <div className="d-flex flex-row justify-content-between">
                  <div className="px-4 pt-3" style={{ cursor: 'pointer' }} onClick={goBack}>
                      <img src={BackImg} alt="" />
                  </div>
                  <div className="px-4 pt-3" style={{cursor: 'pointer'}} onClick={onClose}>
                    <img src={closeImage}/>
                  </div>
              </div>
              <div className='d-flex justify-content-center'><img src={imageSrc} alt="" /></div>
              <div className='mt-1 title'> <h1>Two-Factor Authentication</h1> </div>
              <div className='mb-3 description'>Enter 6-digits code from your Google Authenticator</div>
              <div className='my-3'>
                <div className={error ? 'authcode error d-flex justify-content-center   ' : 'authcode d-flex justify-content-center'}>
                    <form onSubmit={handleOnSubmit}>
                      <OtpInput
                        value={result}
                        onChange={handleOnChange}
                        numInputs={6}
                        shouldAutoFocus={true}
                        isInputNum={true}
                      />
                        <Button className='d-none' type='submit' />
                    </form>
                </div>
                {error ? <div className='error-message'>Incorrect or expired code, please try again.</div> : <></>}

              </div>

              {error ? <div className='d-flex justify-content-center confirm-button'>
                  <div>Having issues? Email us at <a href="mailto: feedback@lqwd.money">feedback@lqwd.money</a> </div>
                  <div><PrimaryButton text={activateMode ? 'Activate' : 'Confirm'} onClick={() => onActivate(result)}></PrimaryButton></div>
                </div> :
                <div className='d-flex justify-content-center confirm-button'>
                  <PrimaryButton text={activateMode ? 'Activate' : 'Confirm'} onClick={() => onActivate(result)}></PrimaryButton>
                </div>}
            </div>
            :
            <div className='confirm-mfa'>
              <div className='d-flex justify-content-center'><img src={imageSrc} alt="" /></div>
              <div className='mt-1 title'> <h1>Two-Factor Authentication</h1> </div>
              <div className='mb-3 description'>Enter 6-digits code from your Google Authenticator</div>
              <div className='my-3'>
                <div className={error ? 'authcode error d-flex justify-content-center   ' : 'authcode d-flex justify-content-center'}>
                    <form onSubmit={handleOnSubmit}>
                        <OtpInput
                          value={result}
                          onChange={handleOnChange}
                          numInputs={6}
                          shouldAutoFocus={true}
                          isInputNum={true}
                        />
                        <Button className='d-none' type='submit' />
                    </form>
                </div>
                {error ? <div className='error-message'>Incorrect or expired code, please try again.</div> : <></>}
              </div>

              {error ? <div className='d-flex justify-content-between m-2 mt-5 confirm-button flex-column'>
                  <div>Having issues? Email us at <a href="mailto: feedback@lqwd.money">feedback@lqwd.money</a> </div>
                  <div className="d-flex flex-row justify-content-between">
                      <PrimaryOutlineButton text={"Close"} onClick={goBack}></PrimaryOutlineButton>
                      <PrimaryButton text={activateMode ? 'Activate' : 'Confirm'} onClick={() => onActivate(result)}></PrimaryButton>
                  </div>
                </div> :
                <div className='d-flex justify-content-between m-2 mt-5 confirm-button'>
                  <PrimaryOutlineButton text={"Return"} onClick={goBack}></PrimaryOutlineButton>
                  <PrimaryButton text={activateMode ? 'Activate' : 'Confirm'} onClick={() => onActivate(result)}></PrimaryButton>
                </div>}
            </div>
        }
      </>

    );
}
