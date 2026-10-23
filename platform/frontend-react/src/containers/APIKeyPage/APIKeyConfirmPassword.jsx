/* eslint-disable */
import React, { useEffect, useState } from "react";
import { Modal } from 'react-bootstrap';
import Password from 'components/Basic/Password';
import PrimaryButton from "components/Buttons/PrimaryButton";

const APIKeyConfirmPassword = ({ onHide, onConfirm, show }) => {
    const [password, setPassword] = useState('');

    return (
        <Modal centered className="" show={show} onHide={onHide} backdrop='static' keyboard="False">
            <Modal.Header closeButton className="border-0 mx-2">
                <div className='d-flex px-3'>
                    <div><h1>Generate API Key</h1></div>
                </div>
            </Modal.Header>
            <Modal.Body className="mx-2">
                <div >
                    <div className=" px-3 mb-3">Enter you platform password to generate API key</div>
                    <div className=" px-3">
                        <Password
                            label='Platform Password'
                            error={false}
                            errorMsg={'Incorrect password, please try again.'}
                            onChange={(value) => { setPassword(value) }}>
                        </Password>

                    </div>
                    <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                        <PrimaryButton text='Confirm' disabled={password==''} onClick={() => onConfirm(password)}></PrimaryButton>
                    </div>
                </div>
            </Modal.Body>
        </Modal>
    );
};

export default APIKeyConfirmPassword;