/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Tour.css';
import { Modal } from 'react-bootstrap';
import Step1 from './Step1'
import Step2 from './Step2'
import Step3 from './Step3'
import Step4 from './Step4'

export default function Tour({ show, onClose }) {
    const [step, setStep] = useState(0);
    const goForward = () => {
        console.log('going to step  ' + (step + 1));
        setStep(step + 1);
    }
    const goBack = () => {
        console.log('going to step  ' + (step - 1));
        setStep(step - 1);
    }

    const handleClose = () => {
        setStep(0);
        onClose();
    }

    return (
        <Modal centered size="md" show={show} onHide={handleClose} backdrop='static' keyboard="False" className='tour'>
            {step != 0 ?
                <Modal.Header className='border-0' closeButton>
                </Modal.Header> : <></>}
            <Modal.Body className='px-4'>
                <div >
                    {step == 0 ? <Step1 goForward={goForward} /> : <></>}
                    {step == 1 ? <Step2 goForward={goForward} /> : <></>}
                    {step == 2 ? <Step3 goForward={goForward} goBack={goBack} /> : <></>}
                    {step == 3 ? <Step4 onClose={handleClose} goBack={goBack} /> : <></>}
                </div>
            </Modal.Body>
        </Modal>

    );
}
