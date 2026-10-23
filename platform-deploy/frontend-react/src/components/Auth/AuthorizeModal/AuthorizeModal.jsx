/* eslint-disable */
import React, { useState, useEffect } from 'react';
import Password from '../../Basic/Password';
import PrimaryButton from "../../Buttons/PrimaryButton";
import { Modal } from 'react-bootstrap';
import BackImg from '../../../public/icons/general/png/Back.png';
import './AuthorizeModal.css';



export default function AuthorizeModal({ show, handleHide, handleConfirm, goBack, error, isNonCustodial }) {
    const [value, setValue] = useState('');
    const [value2, setValue2] = useState('');


    const onChangePassword = (val) => {
        setValue(val);
    }

    const onChangePassphrase = (val) => {
        setValue2(val);
    }

    return (
        <div>
            <Modal centered className="" show={show} onHide={handleHide} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="border-0 mx-2">
                    <div className='d-flex '>
                        <div style={{ cursor: 'pointer' }} onClick={goBack}><img src={BackImg} alt="" /></div>
                        <div><h1>Authorize</h1></div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-2">
                    <div >
                        <div className=" px-3">
                            <Password label='Platform Password' error={error} errorMsg={'Incorrect password, please try again.'} onChange={onChangePassword}></Password>
                        </div>
                        {isNonCustodial ?
                            <div className=" px-3">
                                <Password label='Node Passphrase' error={error} errorMsg={'Incorrect passphrase, please try again.'} onChange={onChangePassphrase}></Password>
                            </div>
                            :
                            <></>
                        }
                        <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                            <PrimaryButton text='Confirm' disabled={value == '' || (isNonCustodial && value2 == '')} onClick={isNonCustodial ? () => handleConfirm(value, value2) : () => handleConfirm(value)}></PrimaryButton>
                        </div>
                    </div>
                </Modal.Body>
            </Modal>

        </div>
    );
}
