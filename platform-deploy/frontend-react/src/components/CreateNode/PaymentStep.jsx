/* eslint-disable */
import React, { useEffect, useState, useRef } from "react";
import { OverlayTrigger } from "react-bootstrap";
import Tooltip from "react-bootstrap/Tooltip";
import CopyImg from '../../public/icons/general/png/Copy.png';
import { QRCodeCanvas } from 'qrcode.react';
import DownloadImg from '../../public/icons/general/png/Download.png';
import PrimaryButton from '../Buttons/PrimaryButton'
import { hideCreateNodeModal } from '../../containers/CreateNode/CreateNodeActions'
import InfoPanel from "../InfoPanel/InfoPanel";

const PaymentStep = ({ step, address, amount,
                         satAmount, btcRate,
                         startDate, endDate,
                         dispatch, onFinish }) => {
    const [show, setShow] = useState(false);
    const canvasRef = useRef();

    const downloadButtonClicked = () => {
        const canvas = canvasRef.current.children[0]?.children[0];
        const pngFile = canvas.toDataURL("image/png");

        const downloadLink = document.createElement("a");
        downloadLink.download = "QrCode";
        downloadLink.href = `${pngFile}`;
        downloadLink.click();
    };

    const renderTooltip = props => (
        <Tooltip {...props} id="copy-tooltip">Copied</Tooltip>
    );
    function copy(text) {
        navigator.clipboard.writeText(text).then(r => {
            setShow(true)
            setTimeout(function () { setShow(false); }, 1000)
        }
        )
    }

    function daysBetween(start, end){
        // To calculate the time difference of two dates
        var Difference_In_Time = new Date(end).getTime() - new Date(start).getTime();

        // To calculate the no. of days between two dates
        var Difference_In_Days = Difference_In_Time / (1000 * 3600 * 24);

        return Difference_In_Days;
    }

    return (
        <div className={`create-node-payment container create-node-step-${step}`}>
            <div className="row">
                <div className="col-6 col-md-6">
                    <div>
                        {`Please Send ${satAmount} Sats to:`}
                    </div>
                    <div className='d-flex'>
                        <div className='flex-grow-1'>
                            <OverlayTrigger placement="top" show={show} overlay={renderTooltip}>
                                <div className="p-2 copy-text">{address}</div>
                            </OverlayTrigger>
                        </div>
                        <div onClick={() => copy(address)}>
                            <img src={CopyImg}></img>
                        </div>

                    </div>
                    <>
                    {
                        amount && btcRate ?
                          <>
                              <small>${Math.round(amount * 100)/100} USD @ ${Math.round(btcRate*100)/100} USD/BTC</small>
                          </>
                          :
                          <></>
                    }
                    </>
                    <br/>
                    <>
                        {(startDate && endDate) ?
                          <>
                              <small>Billed for: {new Date(startDate).toLocaleDateString("en-US")} - {new Date(endDate).toLocaleDateString("en-US")} ({daysBetween(startDate, endDate)} days)</small>
                              <br/>
                          </>
                          :
                          <></>
                        }
                    </>
                </div>
                <div className="col-12 col-md-6">
                    <div>
                        QR code
                    </div>
                    <div>
                        <div className="qr-code-frame">
                            <div className="qr-code-border">
                                <div className="qr-code-download">
                                    <img className="qr-code-download-icon" src={DownloadImg} onClick={() => downloadButtonClicked()} />
                                </div>
                                <div ref={canvasRef} className="qr-code-scan">
                                    <div>
                                        <QRCodeCanvas value={address} id="qr-gen-subscription-payment"></QRCodeCanvas>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
                <div className="col-12 justify-content-center align-content-center">
                    <InfoPanel error={true} text={"Please Activate node within 25 min or it will be deleted."} className={"justify-content-center text-center"}></InfoPanel>
                </div>
                <div className="col-12">
                    <div className="d-flex justify-content-end px-3 my-2" >
                        {/* <InheritButton text='Back' onClick={() => goBack(step, null)}></InheritButton> */}
                        <PrimaryButton
                            text='Finish'
                            onClick={onFinish}></PrimaryButton>

                    </div>
                </div>
            </div>

        </div>
    );
};

export default PaymentStep;

