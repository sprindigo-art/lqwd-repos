/* eslint-disable */
import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { hideRestartNodeModal } from './RestartNodeActions';
import { requestRestartLNDNode } from '../../requests/Node'
import { useSnackbar } from 'notistack';
import NotificationDuration from 'NotificationDuration'
import BackImg from '../../public/icons/general/png/Back.png';
import DangerButton from "../../components/Buttons/DangerButton";
import InheritButton from "../../components/Buttons/InheritButton";
import { Modal } from 'react-bootstrap';
import TextPanel from '../../components/InfoPanel/InfoPanel';
import Password from '../../components/Basic/Password'
import BlockUi from 'react-block-ui';

const RestartNode = ({ ...rest }) => {
    const dispatch = useDispatch();
    const { enqueueSnackbar } = useSnackbar();
    const [passphrase, setPassphrase] = useState('');
    const [password, setPassword] = useState('');
    const [disableRestart, setDisableRestart] = React.useState(false);

    const restartNodeModalShow = useSelector(state => state.restartNodeReducer.showModal);
    const lndname = useSelector(state => state.restartNodeReducer.nodeName);
    const isNonCustodial = useSelector(state => state.restartNodeReducer.isNonCustodial);
    const status = useSelector(state => state.restartNodeReducer.status);

    const messages = {
        successNotification: status != 'IS_AWAITING_WALLET_UNLOCK' ? 'Node is restarting' : 'Unlocking Wallet' ,
        errorNotification: status != 'IS_AWAITING_WALLET_UNLOCK' ? 'Error occured when restarting node!' : 'Error occured when unlocking wallet!' ,
        button: status != 'IS_AWAITING_WALLET_UNLOCK' ? 'Restart' : 'Unlock Wallet' ,
        header: status != 'IS_AWAITING_WALLET_UNLOCK' ? 'Restart Node' : 'Unlock Wallet' ,
        confirmation: status != 'IS_AWAITING_WALLET_UNLOCK' ? `Are you sure? This is restarting your node, ${lndname}.` : `Are you sure? This is restarting your node, ${lndname}.` ,
    }

    const handleClose = () => {
        dispatch(hideRestartNodeModal());
    }

    const handleRestartNodeAction = () => {
        let data = {
            lndname,
            password: password,
            ...(passphrase != '' && { passphrase: passphrase }),
            action: status != 'IS_AWAITING_WALLET_UNLOCK' ? 'RESTART_REQUESTED' : 'UNLOCK_REQUESTED',
        }

        //temporary disable delete button until response received
        setDisableRestart(true);

        requestRestartLNDNode(data)
            .then(function (response) {
                enqueueSnackbar(messages.successNotification, { variant: 'success', autoHideDuration: NotificationDuration });
                console.log(response);
                setDisableRestart(false);
                dispatch(hideRestartNodeModal());
                // dispatch(hideNodeDetailsModal());
            }).catch(function (error) {
                enqueueSnackbar(messages.errorNotification, { variant: 'error', autoHideDuration: NotificationDuration });
                console.log(error);
                setDisableRestart(false);
                dispatch(hideRestartNodeModal());
            });
    }

    return (
        <>
            <Modal centered className="" show={restartNodeModalShow} onHide={handleClose} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="mx-2">
                    <div className='d-flex '>
                        <div style={{ cursor: 'pointer' }} onClick={() => handleClose()}><img src={BackImg} alt="" /></div>
                        <div><h1>{messages.header} {lndname}</h1></div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-2">
                    <BlockUi tag="div" blocking={disableRestart}>
                        <div >
                            <div className=" px-3">
                                <TextPanel error={true} text={messages.confirmation}></TextPanel>
                                <Password className='my-3' label='Platform Password' onChange={(value) => { setPassword(value) }} ></Password>
                                {(isNonCustodial == true) ? <Password className='my-3' label='Passphrase' onChange={(value) => { setPassphrase(value) }} ></Password> : <></>}
                                
                            </div>
                            <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                                <InheritButton text='Cancel' onClick={() => handleClose()}></InheritButton>
                                <DangerButton text={messages.button}  disabled={password=='' || (isNonCustodial && passphrase=='')} onClick={handleRestartNodeAction}></DangerButton>
                            </div>
                        </div>
                    </BlockUi>
                </Modal.Body>
            </Modal>
        </>
    );
};

export default RestartNode;