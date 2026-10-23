/* eslint-disable */
import React from 'react';
import {Modal} from "react-bootstrap";
import PrimaryButton from "../../components/Buttons/PrimaryButton";

const SendToEmailSuccessModal = ({show, onHideCallback, handleHideCallback, email} ) => {

    return (
        <div>
            <Modal centered className="cust-modal-sm" show={show} size='md' onHide={onHideCallback} backdrop='static'
                   keyboard="False">
                <Modal.Header closeButton className="cus-header">
                </Modal.Header>

                <Modal.Body>
                    <div className={"d-flex flex-column justify-content-center"}>
                        <div className='mt-3 d-flex justify-content-center'>
                            <svg width="47" height="49" viewBox="0 0 47 49" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M23.5762 0.543945C10.8453 0.543945 0.525391 11.2259 0.525391 24.4036C0.525391 37.5813 10.8453 48.2632 23.5762 48.2632C36.3072 48.2632 46.6271 37.5813 46.6271 24.4036C46.6271 11.2259 36.3072 0.543945 23.5762 0.543945ZM18.9661 37.3212L8.11603 26.0905L11.3754 22.7167L18.9661 30.5737L35.7771 13.1729L39.0364 16.5466L18.9661 37.3212Z" fill="#24AB20"/>
                            </svg>
                        </div>


                        <div className='mt-3 d-flex justify-content-center details-title'>
                            Invoice has been sent
                        </div>

                        <div className='d-flex justify-content-center node-balance-title'>
                            {email} will receive the invoice shortly.
                        </div>
                    </div>


                    <div className="col-12 mb-3 d-flex justify-content-center pt-3 pr-0">
                        <PrimaryButton text='Done' onClick={handleHideCallback}/>
                    </div>
                </Modal.Body>
            </Modal>

        </div>
    );
}

export default SendToEmailSuccessModal;


