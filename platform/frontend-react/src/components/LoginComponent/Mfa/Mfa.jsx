/* eslint-disable */
import React, { useState} from 'react';
import './Mfa.css';
import { Modal } from 'react-bootstrap';
import { QRCodeCanvas } from 'qrcode.react';
import CopyText from "../../CopyText/CopyText";
import PrimaryButton from '../../Buttons/PrimaryButton';
import ConfirmMfa from '../ConfirmMfa/ConfirmMfa';

export default function Mfa({ show, onCancel, onActivate, secret, mfaUrl, mobile }) {
    //step 0: get code
    //step 1: activate
    //step 2: hide mfa
    const [step, setStep] = useState(0);
    const [error, setError] = useState(false);

    const handleActivate = (result) => {
        onActivate(result, (err) => {
            if (err) {
                setError(true);
            }else{
                setStep(0);
                setError(false);
            }
        });
    }
    const handleCancel = () => {
        setStep(0);
        onCancel();
    }

    const SetupMFA = ({ mobile }) => {
        return (
            <>
              {mobile?
                <CopyText text={secret} className="copy-address"></CopyText>
                :
                <>
                <div className='qrcode'>
                    <QRCodeCanvas value={mfaUrl}></QRCodeCanvas>
                </div>
                <div className='my-3'>
                  <div>Or enter the following code manually:</div>
                  <div>
                    <CopyText text={secret} className="copy-address"></CopyText>
                  </div>
                </div>
                </>
              }
                <div className='my-1'>Once registered, you’ll see 6-digit verification code in the app.</div>
                <div className='mt-3'><h1>Don’t have the app?</h1></div>
                <div>Google Authenticator is a free 2FA app. Dowload the app for <a href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2&hl=en&gl=US">Android</a>  or <a href="https://apps.apple.com/us/app/google-authenticator/id388497605">iOS</a> .</div>
                <div className='d-flex justify-content-end my-1'> <PrimaryButton text='Continue' onClick={() => setStep(1)}></PrimaryButton> </div>
            </>
        )
    }



    return (
      <>
      {mobile ?
        <>
            {step == 0 ?
              <Modal className='mfa' centered show={show} onHide={() => handleCancel()} backdrop='static'
                     keyboard="False">
                  <Modal.Header className='border-0' closeButton>
                      {step == 0 ?
                        <div className=''>
                            <h1>Set up two-factor authentication</h1>
                            <div>To secure your account, open your Google Authenticator App and enter the following
                                code.
                            </div>
                        </div> :
                        <></>
                      }
                  </Modal.Header>
                  <Modal.Body className='px-4'>
                      <div>
                          {step == 0 ? <SetupMFA mobile={mobile} /> : <></>}
                      </div>
                  </Modal.Body>
              </Modal>
              :
              <ConfirmMfa show={step == 1} onActivate={handleActivate} activateMode={true} error={error} mobile={mobile}
                          onClose={() => handleCancel()} goBack={() => setStep(0)}
                          style={{ position: "absolute", zIndex: 9 }} />
            }
        </>
          :
          <Modal className='mfa' centered show={show} onHide={() => handleCancel()} backdrop='static' keyboard="False">
            <Modal.Header className='border-0' closeButton>
              {step == 0 ? <div className=''>
                <h1>Set up two-factor authentication</h1>
                <div>To secure your account, scan the QR code below with your Google Authenticator App.</div>
              </div> : <></>}
            </Modal.Header>
            <Modal.Body className='px-4'>
              <div >
                {step == 0 ? <SetupMFA /> : <></>}
                {step == 1 ? <ConfirmMfa show={step == 1} onActivate={handleActivate} activateMode={true} error={error} mobile={mobile} style={{position: "relative"}} onClose={() => handleCancel()} goBack={() => setStep(0)}/> : <></>}
              </div>
            </Modal.Body>
          </Modal>
      }
      </>

    );
}
