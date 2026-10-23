/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './CreateNodeModal.css';
import { Modal, Form } from 'react-bootstrap';

import AuthorizeModal from '../Auth/AuthorizeModal/AuthorizeModal'
import ConfirmSelfManagedModal from './ConfirmSelfManagedModal/ConfirmSelfManagedModal'
import CreateNode from '../CreateNode/CreateNode'
import { setPaymentAndCreateNode  } from '../../containers/CreateNode/CreateNodeActions'



const CreateNodeState = {
    GetData: 0,
    ConfirmSelfManaged: 1,
    Authenticate: 2,

}

export default function CreateNodeModal({ show, handleClose, subscriptions, dispatch, createNodeReducer }) {

    const [state, setState] = useState(CreateNodeState.GetData);
    const [payment, setPayment] = useState(-1);


    const handleHide = () => {
        setState(CreateNodeState.GetData);
        handleClose('canceled', null);
    };

    const onCreateNode = (paymentIndex) => {
        setState(CreateNodeState.Authenticate);
        setPayment(paymentIndex);
    }


    const confirmCreateNode = (value) => {
        setState(CreateNodeState.GetData);
        dispatch(setPaymentAndCreateNode({ payment, password: value, }));

    };




    return (
        <>
            <Modal centered size="xl" className="create-node-modal" show={show && state == CreateNodeState.GetData} onHide={handleHide} backdrop='static' keyboard="False">
                <Modal.Header closeButton className='border-0'>
                    <div className="p-2 container create-node-title">Create a Node</div>
                </Modal.Header>
                <Modal.Body>
                    <CreateNode
                        subscriptions={subscriptions}
                        onCreateNode={onCreateNode}
                        goToStep={(step) => setActiveStep(step - 1)}
                        dispatch={dispatch}
                        createNodeReducer={createNodeReducer}
                    />

                </Modal.Body>
            </Modal>
            <AuthorizeModal
                show={show && state == CreateNodeState.Authenticate}
                handleConfirm={confirmCreateNode}
                goBack={() => setState(CreateNodeState.GetData)}
                handleHide={() => setState(CreateNodeState.GetData)}
            />

            <ConfirmSelfManagedModal
                show={show && state == CreateNodeState.ConfirmSelfManaged}
                handleConfirm={() => setState(CreateNodeState.Authenticate)}
                goBack={() => setState(CreateNodeState.GetData)}
                handleHide={() => setState(CreateNodeState.GetData)}
            />
        </>
    );
}