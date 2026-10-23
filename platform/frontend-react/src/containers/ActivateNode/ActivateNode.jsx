/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './ActivateNode.css'
import { useSelector, useDispatch } from 'react-redux';
import SeedsModal from '../../components/MnemonicSeed/MnemonicSeed';
import { ActivateModalConfirmExpired, hideActivateModal, tryConfirmSeed } from "./ActivateNodeActions";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import { Modal } from 'react-bootstrap';

const ActivateModal = () => {
    const dispatch = useDispatch();

    const handleConfirm = () => {

        dispatch(tryConfirmSeed(activateModal));
        dispatch(hideActivateModal());
    }

    const handleHide = () => {
        console.log('closing')
        console.log(JSON.stringify(activateModal))
        dispatch(hideActivateModal());
    }
    const confirmExpired = () => {
        dispatch(ActivateModalConfirmExpired());
    }


    const activateModal = useSelector(state => state.activateReducer);

    return (
        <>
            <SeedsModal
                show={activateModal.showModal && !activateModal.confirmExpired}
                seeds={activateModal.seeds}
                handleConfirm={handleConfirm}
                handleHide={handleHide}
                confirmationSeedsIndexes={activateModal.confirmationSeedsIndexes}
            />
            <Modal centered className="" show={activateModal.showModal && activateModal.confirmExpired} onHide={confirmExpired} backdrop='static' keyboard="False">
                <Modal.Header closeButton className='border-0'>
                    <h1>Seed Expired</h1>
                </Modal.Header>
                <Modal.Body className='px-4'>
                    <div>

                        <span>Please delete and re-create node... </span>
                        <br /> 
                        <span>Node and Seed must be confirmed within 30 minutes.</span>
                    </div>
                    <div className='ps-auto w-100 my-3'>

                        <PrimaryButton text='Got it' onClick={handleHide}></PrimaryButton>
                    </div>
                </Modal.Body>
            </Modal>
        </>
    );
};

export default ActivateModal;
