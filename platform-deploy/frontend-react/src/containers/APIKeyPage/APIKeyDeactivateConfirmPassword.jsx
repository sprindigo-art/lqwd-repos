/* eslint-disable */
import React, { useEffect, useState } from "react";
import { Modal } from 'react-bootstrap';
import Password from 'components/Basic/Password';
import DangerButton from "components/Buttons/DangerButton";
import InheritButton from "components/Buttons/InheritButton";
import InfoPanel from 'components/InfoPanel/InfoPanel'

const APIKeyConfirmPassword = ({ onHide, onConfirm, show }) => {
    const [password, setPassword] = useState('');

    return (
        <Modal centered className="" show={show} onHide={onHide} backdrop='static' keyboard="False">
            <Modal.Header closeButton className="border-0 mx-2">
                <div className='d-flex px-3'>
                    <div><h1>Deactivate API Key</h1></div>
                </div>
            </Modal.Header>
            <Modal.Body className="mx-2">
                <div >
                    <div className=" px-3 mb-3">
                    <InfoPanel error={true} text={"Are you sure? Once it's deactivated, you will not be able to recover it."}/>
                    </div>
                    <div className=" px-3">
                        <Password
                            label='Platform Password'
                            error={false}
                            errorMsg={'Incorrect password, please try again.'}
                            onChange={(value) => { setPassword(value) }}>
                        </Password>

                    </div>
                    <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                        <InheritButton text='Cancel' onClick={onHide}></InheritButton>
                        <DangerButton text='Deactivate' disabled={password==''} onClick={() => onConfirm(password)}></DangerButton>
                    </div>
                </div>
            </Modal.Body>
        </Modal>
    );
};

export default APIKeyConfirmPassword;