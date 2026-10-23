/* eslint-disable */
import './DeleteNodeModal.css';
import React, { useState, useEffect } from 'react';
import BackImg from '../../../public/icons/general/png/Back.png';
import DangerButton from "../../Buttons/DangerButton";
import InheritButton from "../../Buttons/InheritButton";
import { Modal } from 'react-bootstrap';
import TextPanel from '../../InfoPanel/InfoPanel';
import Password from '../../Basic/Password'
import BlockUi from 'react-block-ui';

export default function DeleteNodeModal({ show, status, handleHide, handleConfirm, goBack, error, node, disableDelete }) {

    const [passphrase, setPassphrase] = useState('');
    const [password, setPassword] = useState('');
    const [force, setForce] = useState(false);

    const onPasswordChanged = (value) => {
        setPassword(value);
    }

    const onDelete = () => {
        handleConfirm(
            {
                password: password,
                force: force,
                ...(passphrase != '' && { passphrase: passphrase })
            }
        )
    }

    let showDelete = force || (node.nodeBalance == undefined || Number(node.nodeBalance.total_balance) == 0);

    const styledText = () => {
        return (
            <div className=''>
                Instead, You can cancel your subscription from&nbsp;<span onClick={() => handleHide('/subscribe')} style={{ fontWeight: 'bold', color: '#0000EE', cursor: 'pointer' }}>here</span>&nbsp;and use your node till the end of your subscription.
            </div>
        )
    }

    return (
        <div>
            <Modal centered className="" show={show && showDelete} onHide={handleHide} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="mx-2">
                    <div className='d-flex '>
                        <div style={{ cursor: 'pointer' }} onClick={goBack}><img src={BackImg} alt="" /></div>
                        <div><h1>Permanently Delete Node {node.lndNodeName}</h1></div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-2">
                    <BlockUi tag="div" blocking={disableDelete}>
                        <div >
                            <div className=" px-3">
                                <TextPanel warn={true} text={styledText()}></TextPanel>
                                <TextPanel error={true} text={`Are you sure? This is permanently delete your node, ${node.lndNodeName}. Once you delete the node, there’s no getting it back.`}></TextPanel>
                                <Password className='my-3' label='Platform Password' onChange={onPasswordChanged} ></Password>
                                {node.isNonCustodial ? <Password className='my-3' label='Passphrase' onChange={(value) => { setPassphrase(value) }} ></Password> : <></>}
                            </div>
                            <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                                <InheritButton text='Cancel' onClick={() => handleHide()}></InheritButton>
                                <DangerButton text='Delete' disabled={password=='' || (node.isNonCustodial && passphrase=='')} onClick={onDelete}></DangerButton>
                            </div>
                        </div>
                    </BlockUi>
                </Modal.Body>
            </Modal>
            <Modal centered className="" show={show && !showDelete} onHide={handleHide} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="mx-2">
                    <div className='d-flex '>
                        <div><h1>Cannot be processed</h1></div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-2">
                    <div >
                        <div className=" px-3">
                            The node can only be deleted with 0 balance. Please transfer your balance to proceed the action.
                        </div>
                        <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                            <InheritButton text='Force Delete' onClick={() => setForce(true)}></InheritButton>
                            <DangerButton text='Got it' onClick={() => handleHide()}></DangerButton>
                        </div>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}
