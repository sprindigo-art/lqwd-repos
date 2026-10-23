/* eslint-disable */
import React from 'react';
import './NodeDetails.css';
import NodeDetailsItem from "./NodeDetailsItem";
import CopyNodeDetailsItem from "./CopyNodeDetailsItem";
import { Modal } from "react-bootstrap";
import PrimaryButton from "../Buttons/PrimaryButton";
import ActivateImg from '../../public/icons/general/png/Activate@3.png';
import WasteIcon from '../../public/icons/general/png/Waste.png';



export default function NodeDetailsConfirmation({ onActivate, onDeleteClick }) {
    return (
        <>
            <Modal.Body>
                <div className="node-details-confirmation d-flex justify-content-center flex-column">
                    <div className='d-flex justify-content-center my-2'>
                        <img src={ActivateImg} alt="" className='' />
                    </div>
                    <div className='d-flex justify-content-center'>
                        <h2>Please activate your self-managed node</h2>
                    </div>
                    <div className='d-flex justify-content-center mt-2'>
                        <PrimaryButton text='Activate' onClick={() => onActivate()} />
                    </div>
                </div>
                <div onClick={() => onDeleteClick()} style={{ cursor: 'pointer', width:'24px', height:'24px' }} className='d-flex flex-column justify-content-end my-2'>
                    <img src={WasteIcon}></img>
                </div>
            </Modal.Body>

        </>
    );
}
