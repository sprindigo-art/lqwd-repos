/* eslint-disable */
import React, {useEffect} from 'react';
import './RqPaymentKeysend.css';
import {useDispatch, useSelector} from 'react-redux';
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import {getHTLCEvent} from "../Dashboard/DashboardActions";
import {getInvoice, getTransaction} from "../../utils/transactionUtil";
import {getFirstAndLastDayOfMonth, processSelectItemNode} from "../../utils/utils";
import TransactionRow from "../../components/Transaction/TransactionRow";
import backIcon from "../../public/icons/general/png/Back.png";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import CopyText from "../../components/CopyText/CopyText";
import SendInvoiceModal from "../RqPaymentCreateInvoice/SendToEmail"
import SendToEmailSuccessModal from "../RqPaymentCreateInvoice/SendToEmailSuccess"
import {
    rqPaymentInvoiceReset,
    rqPaymentInvoiceSendEmail,
    rqPaymentSetEmail,
    rqPaymentShowEmailDialog
} from "../RqPaymentCreateInvoice/RqPaymentCreateInvoiceActions";
import {
    rqPaymentKeyGetInvoices,
    rqPaymentKeyReset, rqPaymentKeySelectNode,
    rqPaymentKeySendEmail,
    rqPaymentKeySetEmail,
    rqPaymentKeySetNodeAddress,
    rqPaymentKeyShowEmailDialog, rqPaymentKeyShowSuccessDialog
} from "./RqPaymentKeysendActions";
import RqPaymentKeysendEmpty from "./RqPaymentKeysendEmpty";
import {NavLink} from "react-bootstrap";
import { useNavigate } from "react-router-dom";




const RqPaymentKeySend = () => {

    const dispatch = useDispatch();
    const navigate = useNavigate();

    const dashboardState = useSelector(state => state.dashboardReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);
    const keySendState = useSelector(state => state.rqPaymentKeySendReducer);


    useEffect(() => {
        dispatch(rqPaymentKeyGetInvoices(true))
    }, []);

    const handleClose = () => {
        dispatch(rqPaymentKeyShowEmailDialog(false))
    }

    const onSendEmailButtonClicked = (item) => {
        dispatch(rqPaymentKeySelectNode(item))
        dispatch(rqPaymentKeySetNodeAddress(`${item.nodepubkey}@${item.privateAddress}:${item.port}`))
        dispatch(rqPaymentKeyShowEmailDialog(true))
    };

    const sendKeySendDetailToEmail = () => {
        dispatch(rqPaymentKeySendEmail(keySendState.nodeAddress,
            keySendState.recipientEmail));
    };

    const emailChange = (event) => {
        dispatch(rqPaymentKeySetEmail(event.target.value))
    }

    const clearState = () => {
        dispatch(rqPaymentKeyReset())
    }

    const closeSuccessDialog = () => {
        dispatch(rqPaymentKeyShowSuccessDialog(false))
    }

    const getKeySendEnabledNodes = (nodes) =>{
        if (nodes.length == 0){
            return {
                hasNodes: false,
                keySendNodes: [],
            }
        }

        let keySendNodes = []
        nodeReducer.nodeList.map((item, num) => {
            if (item.keySendEnabled){
                keySendNodes.push(item)
            }
        });

        return {
            hasNodes: true,
            keySendNodes,
        }

    }


    let invoices = getInvoice(keySendState.invoices)

    let keySendRes = getKeySendEnabledNodes(nodeReducer.nodeList)

    return (
        <div className="h-100">
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
                            <div className="my-node-title">Direct Payment (Keysend)</div>
                        </div>
                        <div className={"p-4 node-balance-title"}>Send your node info with direct payment enabled below to the payer for payment deposit. </div>

                        <div className="mt-3 rq-create-invoice-view">

                            <div className="rq-invoice-detail">

                                <div className="mt-3 rq-create-invoice-holder d-flex flex-column">

                                    {!keySendRes.hasNodes ?
                                        <RqPaymentKeysendEmpty title={"Enable Direct Deposit"}
                                                               desc={"Set up direct payment on node creation to receive a payment without creating an invoice."}/>
                                        :
                                        keySendRes.keySendNodes.length == 0 ?
                                            <RqPaymentKeysendEmpty title={"Direct deposit has not been enabled"}
                                                                   desc={"To receive a payment without creating an invoice, create a node with direct payment enabled."}/>
                                            :
                                            <>
                                                {keySendRes.keySendNodes.map((item, num) => (
                                                    <div className={"mt-3"}>
                                                        <div className="pb-1 dropdown node-balance-title">
                                                            {item.lndNodeName}
                                                        </div>
                                                        <CopyText classNames={"justify-content-between"}
                                                                  text={`${item.nodepubkey}@${item.privateAddress}:${item.port}`}/>

                                                        <div className="mt-3 d-flex justify-content-start">
                                                            <PrimaryButton onClick={() => onSendEmailButtonClicked(item)}
                                                                           text={"Send via Email"}/>
                                                        </div>

                                                    </div>))}
                                            </>
                                    }


                                </div>


                            </div>


                        </div>


                    </div>

                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        <div className="p-2">
                            <h2 className="text-align-center">Recent Direct Deposit</h2>
                        </div>

                        {Object.keys(invoices).length > 0 ?

                            <>
                                {
                                    Object.entries(invoices).map(([key, value]) =>
                                        <TransactionRow transactions={value} date={key}/>
                                    )
                                }
                            </>

                            : ""}


                        {(Object.keys(invoices).length === 0)
                            ? <TransactionEmpty text={"Looks like you don’t have any invoice yet"}/>
                            : ""}

                    </div>
                </div>
            </div>
            <SendInvoiceModal info={keySendState.selectedNode == null ? "" :`Send ${keySendState.selectedNode.lndNodeName} info.`}
                              onHideCallback={handleClose} handleBtnCallback={sendKeySendDetailToEmail} emailCallback={emailChange}
                              show={keySendState.showEmailDialog}/>
            <SendToEmailSuccessModal email={keySendState.recipientEmail}  onHideCallback={closeSuccessDialog} handleHideCallback={clearState}
                                     show={keySendState.showSuccessDialog}/>
        </div>
    );
};

export default RqPaymentKeySend;
