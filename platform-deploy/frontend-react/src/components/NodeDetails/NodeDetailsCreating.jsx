/* eslint-disable */
import React from 'react';
import './NodeDetails.css';
import NodeDetailsItem from "./NodeDetailsItem";
import CopyNodeDetailsItem from "./CopyNodeDetailsItem";
import { Modal } from "react-bootstrap";
import processImg from '../../public/icons/general/png/Process@2.png';
import WasteIcon from '../../public/icons/general/png/Waste.png';

export default function NodeDetailsCreating({ onDeleteClick }) {
    return (
        <>
            <Modal.Body>
                <div className="node-details-creating d-flex justify-content-center flex-column">
                    <div className='d-flex justify-content-center my-2'>
                        <img src={processImg} alt="" className='rotate' />
                    </div>
                    <div className='d-flex justify-content-center'>
                        <h2>Creating Node</h2>
                    </div>
                    <div className='d-flex justify-content-center'>
                        <p>Please wait, we are working hard on creating your node :) <br />It will take a few minutes to complete. </p>
                    </div>
                </div>
                <div onClick={() => onDeleteClick()} style={{ cursor: 'pointer', width: '24px', height: '24px' }} className='d-flex flex-column justify-content-end my-2'>
                    <img src={WasteIcon}></img>
                </div>
            </Modal.Body>
        </>
    );
}
