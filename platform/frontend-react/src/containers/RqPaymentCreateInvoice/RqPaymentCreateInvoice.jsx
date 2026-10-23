/* eslint-disable */
import React, { useEffect, useRef, useState } from 'react';
import './RqPaymentCreateInvoice.css';
import { useDispatch, useSelector } from 'react-redux';
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import { getHTLCEvent } from "../Dashboard/DashboardActions";
import { getInvoice, getTransaction } from "../../utils/transactionUtil";
import { getFirstAndLastDayOfMonth, processSelectItemNode } from "../../utils/utils";
import TransactionRow from "../../components/Transaction/TransactionRow";
import backIcon from "../../public/icons/general/png/Back.png";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import NodeDetailsItem from "../../components/NodeDetails/NodeDetailsItem";
import CopyText from "../../components/CopyText/CopyText";
import DownloadImg from "../../public/icons/general/png/Download.png";
import { QRCodeCanvas } from "qrcode.react";
import SendInvoiceModal from "./SendToEmail";
import SendToEmailSuccessModal from "./SendToEmailSuccess";
import Select from "../../components/Basic/Select";
import SatInputConvert from "../../components/Basic/SatInputConvert";
import processImg from "../../public/icons/general/png/Process@2.png";
import { useSnackbar } from 'notistack';

import {
    rqPaymentInvoiceAmountChange,
    rqPaymentInvoiceCreateNode,
    rqPaymentInvoiceCreateNodeFailed,
    rqPaymentInvoiceCreateNodeSuccess,
    rqPaymentInvoiceGetInvoices,
    rqPaymentInvoiceReset,
    rqPaymentInvoiceSelectNode,
    rqPaymentInvoiceSendEmail,
    rqPaymentSetEmail,
    rqPaymentShowEmailDialog,
    rqPaymentShowSuccessDialog
} from "./RqPaymentCreateInvoiceActions";
import { NavLink } from "react-bootstrap";
import NodeSelect from "../../components/Basic/NodeSelect";
import NotificationDuration from 'NotificationDuration'
import AuthorizeModal from '../../components/Auth/AuthorizeModal/AuthorizeModal'
import { useNavigate } from "react-router-dom";
import { requestCreateInvoice } from "../../requests/Payment";



const RqPaymentCreateInvoice = () => {

    const navigate = useNavigate();
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const [showAuthorize, setShowAuthorize] = useState(false);

    const canvasRef = useRef();
    const dispatch = useDispatch();

    const createInvoiceState = useSelector(state => state.rqPaymentInvoiceReducer);
    const dashboardState = useSelector(state => state.dashboardReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);


    const downloadClicked = () => {
        const canvas = canvasRef.current.children[0]?.children[0];
        const pngFile = canvas.toDataURL("image/png");
        console.log(pngFile)

        const downloadLink = document.createElement("a");
        downloadLink.download = "QrCode";
        downloadLink.href = `${pngFile}`;
        downloadLink.click();
    };



    const handleClose = () => {
        dispatch(rqPaymentShowEmailDialog(false))
    }

    const onSendEmailButtonClicked = () => {
        dispatch(rqPaymentShowEmailDialog(true))
    };

    const sendInvoiceToEmail = () => {
        const canvas = canvasRef.current.children[0]?.children[0];
        const pngFile = canvas.toDataURL("image/png");
        let invoiceBase64 = pngFile.split(',')[1]

        dispatch(rqPaymentInvoiceSendEmail(createInvoiceState.amount,
            invoiceBase64, createInvoiceState.recipientEmail,
            createInvoiceState.invoiceResponse.payment_addr,
            createInvoiceState.invoiceResponse.payment_request));
    };

    const selectNode = (value) => {
        dispatch(rqPaymentInvoiceSelectNode(JSON.parse(value)))
    }

    const amountChange = (event) => {
        dispatch(rqPaymentInvoiceAmountChange(event.target.value))
    }

    const emailChange = (event) => {
        dispatch(rqPaymentSetEmail(event.target.value))
    }

    const createInvoice = () => {
        if (createInvoiceState.amount && createInvoiceState.selectedNode && createInvoiceState.selectedNode.lndNodeName != '') {
            setShowAuthorize(true)
        } else {
            enqueueSnackbar('Please fill the required fields', { variant: 'warning', autoHideDuration: NotificationDuration });
        }
    }

    const confirmCreateInvoice = (password, passphrase) => {
        requestCreateInvoice({
            "amount":createInvoiceState.amount,
            "nodename":createInvoiceState.selectedNode.lndNodeName,
            password,
            passphrase
        }).then(function(response){
            console.log(response);
            if (response.status !== 400){
                dispatch(rqPaymentInvoiceCreateNodeSuccess(response))
            }else{
                enqueueSnackbar(response.message, { variant: 'error', autoHideDuration: NotificationDuration });
            }
            setShowAuthorize(false)
        }).catch(function(err){
           console.log(err);
            setShowAuthorize(false)
            dispatch(rqPaymentInvoiceCreateNodeFailed(err))
            enqueueSnackbar("Failed to create invoice. Please try again.", { variant: 'error', autoHideDuration: NotificationDuration });
        });
    }

    const clearState = () => {
        dispatch(rqPaymentInvoiceReset())
    }

    const closeSuccessDialog = () => {
        dispatch(rqPaymentShowSuccessDialog(false))
    }


    let date = getFirstAndLastDayOfMonth()

    useEffect(() => {
        // dispatch(getHTLCEvent(date.first_date, date.last_date))
        dispatch(rqPaymentInvoiceGetInvoices(false))

    }, []);


    let invoices = getInvoice(createInvoiceState.invoices, "Invoice")
    // let transactions = getTransaction(dashboardState.htlc)
    let nodeList = processSelectItemNode(nodeReducer.nodeList.concat(nodeReducer.sharedNodeList))

    return (
        <div className="h-100">
            <AuthorizeModal
                show={showAuthorize}
                handleConfirm={confirmCreateInvoice}
                handleHide={()=> setShowAuthorize(false)}
                goBack={()=> setShowAuthorize(false)}
                isNonCustodial={createInvoiceState.selectedNode && createInvoiceState.selectedNode.isNonCustodial}
            />
            <div className="container-fluid dashboard-container h-100">
                <div className="row h-100">

                    <div className="col-12 col-lg-9 px-5 pt-5">
                        <div className="d-flex">
                            <div className="align-self-center">
                                <div style={{ textDecoration: 'none', cursor:'pointer' }} onClick={() => navigate("/request-payment")}>
                                    <img
                                        src={backIcon}
                                    />
                                </div>
                            </div>
                            <div className="my-node-title">Create Invoice</div>
                        </div>

                        <div className="mt-5 rq-create-invoice-view">
                            {!createInvoiceState.loading && createInvoiceState.invoiceResponse == null ?


                                <div className="rq-create-invoice-holder">
                                    <div className="mb-3">
                                        <NodeSelect label={"Node"} onChange={selectNode} options={nodeList} placeholder={'Select a node to deposit'} />
                                    </div>


                                    <SatInputConvert onChange={(event) => amountChange(event)}
                                        label={"Amount"}
                                    />

                                </div>
                                :
                                <></>

                            }

                            {createInvoiceState.loading ?

                                <div className="d-flex justify-content-center flex-column rq-create-invoice-holder">
                                    <div className='mt-5 d-flex justify-content-center my-2'>
                                        <img src={processImg} alt="" className='rotate' />
                                    </div>
                                    <div className='mt-3 d-flex justify-content-center'>
                                        <h2>Creating Invoice</h2>
                                    </div>
                                    <div className='mb-5 d-flex justify-content-center'>
                                        92%
                                    </div>

                                </div>
                                :
                                <></>

                            }

                            {createInvoiceState.invoiceResponse != null ?

                                <div className="rq-invoice-detail">
                                    <div className="p-3 d-flex flex-column my-2">
                                        <div className="pb-1 dropdown node-balance-title">
                                            Invoice Amount
                                        </div>
                                        <div className="pt-1 node-balance-body">
                                            {createInvoiceState.amount} sats
                                        </div>
                                        <hr className="p-3 divider-custom text-black" />
                                        <div className="p-1">
                                            <NodeDetailsItem className="text-white"
                                                title={"Deposit to"}
                                                value={createInvoiceState.selectedNode.lndNodeName} />
                                        </div>

                                        <div className="mt-3 d-flex justify-content-start">
                                            <PrimaryButton onClick={onSendEmailButtonClicked}
                                                text={"Send Invoice via Email"} />
                                        </div>

                                    </div>

                                    <div className="mt-3 rq-create-invoice-holder d-flex flex-column">

                                        <div className="pb-1 dropdown node-balance-title">
                                            Invoice
                                        </div>
                                        <CopyText classNames={"justify-content-between"}
                                            text={createInvoiceState.invoiceResponse.payment_request} />

                                        <div className="mt-3 dropdown node-balance-title">
                                            Qr code
                                        </div>

                                        <div className="mt-3 qr-code-frame">
                                            <div className="qr-code-border d-flex">
                                                <div className="qr-code-download">
                                                    <img className="qr-code-download-icon"
                                                        onClick={() => downloadClicked()} src={DownloadImg} />
                                                </div>
                                                <div ref={canvasRef} className="qr-code-scan">
                                                    <div>
                                                        <QRCodeCanvas value={createInvoiceState.invoiceResponse.payment_request}></QRCodeCanvas>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                    </div>


                                </div>
                                :
                                <></>

                            }


                        </div>

                        {createInvoiceState.invoiceResponse == null ?
                            <div className="mt-3 d-flex justify-content-end">
                                <PrimaryButton onClick={createInvoice} disabled={createInvoiceState.loading}
                                    text={createInvoiceState.loading ? "Creating" : "Create"} />
                            </div>
                            :
                            <div className="mt-3 d-flex justify-content-end">
                                <PrimaryButton onClick={clearState}
                                    text={"Done"} />
                            </div>}

                    </div>

                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        <div className="p-2">
                            <h2 className="text-align-center">Recent Invoices</h2>
                        </div>

                        {Object.keys(invoices).length > 0 ?

                            <>
                                {
                                    Object.entries(invoices).map(([key, value]) =>
                                        <TransactionRow transactions={value} date={key} />
                                    )
                                }
                            </>

                            : ""}


                        {(Object.keys(invoices).length === 0)
                            ? <TransactionEmpty text={"Looks like you don’t have any invoice yet"} />
                            : ""}

                    </div>
                </div>
            </div>
            <SendInvoiceModal info={createInvoiceState.selectedNode == null ? "" : `Invoice amount: $ ${createInvoiceState.amount} sats\n` +
                `Deposit to: ${createInvoiceState.selectedNode.lndNodeName} - $ ${createInvoiceState.amount} sats`}
                onHideCallback={handleClose} handleBtnCallback={sendInvoiceToEmail} emailCallback={emailChange}
                show={createInvoiceState.showEmailDialog} />
            <SendToEmailSuccessModal email={createInvoiceState.recipientEmail} onHideCallback={closeSuccessDialog} handleHideCallback={closeSuccessDialog}
                show={createInvoiceState.showSuccessDialog} />
        </div>
    );
};

export default RqPaymentCreateInvoice;
