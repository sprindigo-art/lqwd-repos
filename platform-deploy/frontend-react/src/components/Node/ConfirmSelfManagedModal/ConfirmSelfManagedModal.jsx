/* eslint-disable */
import './ConfirmSelfManagedModal.css';
import React, { useState, useEffect } from 'react';
import PrimaryButton from "../../Buttons/PrimaryButton";
import { Modal } from 'react-bootstrap';
import BackImg from '../../../public/icons/general/png/Back.png';
import TextPanel from '../../InfoPanel/InfoPanel'

const warningText = () => {
    return (
        <p style={{color:'#D88202'}}>Please Confirm You Understand the following conditions regarding <strong>self-managed node</strong> creation.
            <br/>
            <br/>
            Please ensure you have received seed and confirmed node with <strong>30 min</strong> of creation or node will be unusable.</p>
    )
}

export default function ConfirmSelfManagedModal({ show, handleHide, handleConfirm, goBack, error }) {

    return (
        <div>
            <Modal centered className="" show={show} size='lg' onHide={handleHide} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="mx-2">
                    <div className='d-flex '>
                        <div style={{ cursor: 'pointer' }} onClick={goBack}><img src={BackImg} alt="" /></div>
                        <div><h1>Confirm Creation of Self-Managed Node</h1></div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-2">
                    <div >
                        <div className=" px-3">

                            <TextPanel warn={true} text={warningText()}></TextPanel>
                        </div>
                        <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                            <PrimaryButton text='Confirm' onClick={() => handleConfirm()}></PrimaryButton>
                        </div>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}
