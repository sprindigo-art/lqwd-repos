/* eslint-disable */
import React, {useRef} from 'react';
import './FundNode.css'
import {Modal} from "react-bootstrap";
import {QRCodeCanvas} from 'qrcode.react';
import DownloadImg from '../../public/icons/general/png/Download.png';
import {useDispatch, useSelector} from "react-redux";
import {hideFundNodeModal} from "./FundNodeActions";
import CopyText from "../../components/CopyText/CopyText";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import processImg from "../../public/icons/general/png/Process@2.png";

const NodeFundModal = () => {
    const canvasRef = useRef();

    const downloadButtonClicked = () => {
        const canvas = canvasRef.current.children[0]?.children[0];
        const pngFile = canvas.toDataURL("image/png");

        const downloadLink = document.createElement("a");
        downloadLink.download = "QrCode";
        downloadLink.href = `${pngFile}`;
        downloadLink.click();
    };

    const dispatch = useDispatch();


    const handleHide = () => {
        dispatch(hideFundNodeModal());
    }




    const fundNodeModal = useSelector(state => state.fundNodeReducer);

    return (
        <div>

            <Modal centered className="cust-modal-sm" show={fundNodeModal.showModal} size='md' onHide={handleHide} backdrop='static'
                   keyboard="False">
                <Modal.Header closeButton className="cus-header">
                    <div id="nodeFundModal" className="flex-column cus-sub-header justify-content-around">
                        <div className="d-sm-flex flex-row align-items-center">
                            <div className="details-title">
                                Funding Node
                            </div>
                        </div>
                        <div className="details-connection p-2">
                            Deposit Address for: <b>{fundNodeModal.nodeName}</b>
                        </div>
                    </div>
                </Modal.Header>
                <Modal.Body>
                    {fundNodeModal.loadingAddress ?
                        <div className="d-flex justify-content-center flex-column">
                            <div className='d-flex justify-content-center my-2'>
                                <img src={processImg} alt="" className='rotate'/>
                            </div>
                            <div className='d-flex justify-content-center'>
                                <h2>Generating Address</h2>
                            </div>
                        </div> :
                        <>
                            <div className="copy-address">
                                <CopyText text={fundNodeModal.response == null || fundNodeModal.response.status != 200 ? "" : fundNodeModal.response.data.address}
                                          classNames="copy-address"></CopyText>
                            </div>

                            <div className="qr-code-divider"></div>

                            <div className="qr-code-container">
                                <div className="qr-code-title">
                                    QR Code
                                </div>
                                <div className="qr-code-frame">
                                    <div className="qr-code-border d-flex">
                                        <div className="qr-code-download">
                                            <img className="qr-code-download-icon" onClick={() => downloadButtonClicked()} src={DownloadImg}/>
                                        </div>
                                        <div ref={canvasRef} className="qr-code-scan">
                                            <div>
                                            <QRCodeCanvas value={fundNodeModal.response == null || fundNodeModal.response.status != 200 ?  "" : fundNodeModal.response.data.address}></QRCodeCanvas>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </>}
                    <div className="col-12 mb-3 d-flex justify-content-end pt-3 pr-0">
                        <PrimaryButton text='Got it' onClick={handleHide}></PrimaryButton>
                    </div>
                </Modal.Body>
            </Modal>
        </div>
    );
}

export default NodeFundModal;


