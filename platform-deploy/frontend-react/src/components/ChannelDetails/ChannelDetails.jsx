/* eslint-disable */
import React, { useState } from 'react';
import { Modal } from "react-bootstrap";
import ChannelBalance from "../ChannelBalance/ChannelBalance";
import connectImg from '../../public/icons/general/svg/Connect.svg';
import CopyText from "../CopyText/CopyText";
import InfoPanel from "../InfoPanel/InfoPanel";
import DangerOutlineButton from "../Buttons/DangerOutlineButton";
import './ChannelDetails.css';
import ChannelDetailsBody from "./ChannelDetailsBody";
import ChannelDetailsHeader from "./ChannelDetailsHeader";

export default function ChannelDetailsModal({ show, handleClose, data, handleCloseAction, isMobile}){


    return (
        <>
            <Modal centered className="channel-details-modal" size="lg" show={show} onHide={handleClose} backdrop='static' keyboard="False">
                <Modal.Header closeButton>
                    <ChannelDetailsHeader channelName={data.channelId} status={data.type}></ChannelDetailsHeader>
                </Modal.Header>
                <Modal.Body>
                    <ChannelDetailsBody handleCloseAction={handleCloseAction} data={data} connectedNode={data.remotePubKey} isMobile={isMobile}></ChannelDetailsBody>
                </Modal.Body>
            </Modal>
        </>
    );
}