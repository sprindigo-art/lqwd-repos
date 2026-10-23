/* eslint-disable */
import React, { useRef } from 'react';
import './NodeFundModal.css'
import PrimaryButton from "../Buttons/PrimaryButton";
import CopyText from "../CopyText/CopyText";
import { Modal } from "react-bootstrap";
import { QRCodeCanvas } from 'qrcode.react';
import DownloadImg from '../../public/icons/general/png/Download.png';


export default function NodeFundModal({ status, ...rest }) {

    let { show, handleClose, data, selectedNode }= rest;
    const canvasRef = useRef();

    const downloadButtonClicked = () => {
        const canvas = canvasRef.current.children[0]?.children[0];
        const pngFile = canvas.toDataURL("image/png");

        const downloadLink = document.createElement("a");
        downloadLink.download = "QrCode";
        downloadLink.href = `${pngFile}`;
        downloadLink.click();
    };

    return (
        <div>
            <Modal centered className="" show={show} size='md' onHide={handleClose} backdrop='static' keyboard="False">
                <Modal.Header closeButton className="cus-header">
                    <div id="nodeFundModal" className="flex-column cus-sub-header justify-content-around">
                        <div className="d-sm-flex flex-row align-items-center">
                            <div className="details-title">
                                Funding Node
                            </div>
                        </div>
                        <div className="details-connection p-2">
                            Deposit Address for: <b>{selectedNode.lndNodeName}</b>
                        </div>
                    </div>
                </Modal.Header>
                <Modal.Body className="mx-3">
                    <div className="copy-address">
                        <CopyText text={data.address} classNames="copy-address"></CopyText>
                    </div>

                    <div className="qr-code-divider"></div>

                    <div className="qr-code-container">
                        <div className="qr-code-title">
                            QR Code
                        </div>
                        <div className="qr-code-frame">
                            <div className="qr-code-border">
                                <div className="qr-code-download">
                                    <img className="qr-code-download-icon" src={DownloadImg} onClick={() => downloadButtonClicked()}/>
                                </div>
                                <div ref={canvasRef} className="qr-code-scan">
                                    <QRCodeCanvas value={data.address}></QRCodeCanvas>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="col-12 mb-3 d-flex justify-content-end pt-3 pr-0">
                        <PrimaryButton text='Close' onClick={handleClose}></PrimaryButton>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}

