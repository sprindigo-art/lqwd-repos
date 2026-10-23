/* eslint-disable */
import React , {useEffect} from 'react';
import './PayKeySend.css';
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import TextArea from "../../components/Basic/TextArea";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import backIcon from '../../public/icons/general/png/Back.png'
import {Box, Step, StepLabel, Stepper} from "@mui/material";
import Select from "../../components/Basic/Select";
import NodeDetailsItem from "../../components/NodeDetails/NodeDetailsItem";
import checkIcon from '../../public/icons/general/svg/check.svg'
import errorIcon from '../../public/icons/general/svg/error.svg'
import {useDispatch, useSelector} from "react-redux";
import InfoPanel from "../../components/InfoPanel/InfoPanel";
import {getTransaction} from "../../utils/transactionUtil";
import TransactionRow from "../../components/Transaction/TransactionRow";
import {processSelectItemNode} from "../../utils/utils";
import {
    sendPaymentKeySendNextStep,
    sendPaymentKeySendPay,
    sendPaymentKeySendSelectNode,
    sendPaymentKeySendUpdateInfo
} from "./PayKeySendActions";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import SatInputConvert from "../../components/Basic/SatInputConvert";
import crypto from "crypto"


const steps = ['Payment Info', 'Verify Information', 'Confirmation'];


const handleNext = (dispatch, state) => {
    dispatch(sendPaymentKeySendNextStep(state.activeStep + 1));
}

const handleStepperNav = (index, dispatch, state) => {
    if (state.activeStep != index && state.activeStep > index) {
        dispatch(sendPaymentKeySendNextStep(index));
    }
}

const handleReset = (dispatch) => {
    dispatch(sendPaymentKeySendNextStep(0));
};

const sendDirectPayment = (dispatch, state) => {
    let dest_pubkey_base64 = Buffer.from(state.destination, 'hex').toString('base64');

    const secret = crypto.randomBytes(32);

    const hash = crypto.createHash('sha256').update(secret).digest('base64');


    const req = {
        "dest": dest_pubkey_base64,
        "amt": state.amount,
        "payment_hash": hash
    }

    dispatch(sendPaymentKeySendPay(req, state.selectedNode.lndNodeName))


}


const selectPaymentNode = (dispatch, value) => {
    dispatch(sendPaymentKeySendSelectNode(JSON.parse(value)))
}

const destinationChanged = (dispatch, value) => {
    dispatch(sendPaymentKeySendUpdateInfo(null, value))
}

const amountChanged = (dispatch, event) => {
    dispatch(sendPaymentKeySendUpdateInfo(event.target.value, null))
}

const PayKeySend = () => {

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const payKeySendState = useSelector(state => state.payKeySendReducer);
    const dashboardState = useSelector(state => state.dashboardReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);

    const search = useLocation().search;

    const setKeySendFromParam = () => {
        const address = new URLSearchParams(search).get("address");
        dispatch(sendPaymentKeySendUpdateInfo(null, address))
    }

    useEffect(() => {
        setKeySendFromParam()
    }, []);

    let transactions = getTransaction(dashboardState.htlc)


    return (
        <div className="h-100">
            <div className="container-fluid dashboard-container h-100">
                <div className="row h-100">

                    <div className="d-sm-flex flex-column col-12 col-lg-9 px-5 pt-5">
                        <div className="d-flex">
                            <div className="align-self-center">
                                <div style={{ textDecoration: 'none', cursor:'pointer' }} onClick={() => navigate("/send-payment")}>
                                <img
                                    src={backIcon}
                                />
                                </div>
                            </div>
                            <div className="my-node-title">Direct Payment (keysend)</div>
                        </div>

                        <Box sx={{width: '100%'}} className="mt-5">
                            <Stepper activeStep={payKeySendState.activeStep}>
                                {steps.map((label, index) => {
                                    const stepProps = {};
                                    const labelProps = {};
                                    return (
                                        <Step onClick={() => handleStepperNav(index, dispatch, payKeySendState)} key={label} {...stepProps}>
                                            <StepLabel {...labelProps}>{label}</StepLabel>
                                        </Step>
                                    );
                                })}
                            </Stepper>

                            {showPageBasedOnIndex(payKeySendState.activeStep, payKeySendState, nodeReducer, dispatch)}

                        </Box>

                    </div>

                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        <div className="p-2">
                            <h2 className="text-align-center">Recent LN Payments</h2>
                        </div>

                        {transactions.sentTransactions.length > 0 ?
                            <TransactionRow
                                transactions={transactions.sentTransactions}
                                date="May 20, 2022"
                            />
                            : ""}
                        {transactions.receivedTransactions.length > 0 ?
                            <TransactionRow
                                transactions={transactions.receivedTransactions}
                                date="May 20, 2022"
                            />
                            : ""
                        }

                        {(transactions.receivedTransactions.length == 0 && transactions.sentTransactions.length == 0)
                            ? <TransactionEmpty text={"Looks like you don’t have any Transaction yet"}/>
                            : ""}}


                    </div>
                </div>
            </div>
        </div>
    );
};

const showPageBasedOnIndex = (index, state, nodeReducer, dispatch) => {
    if (index == 0) {
        return paymentInfo(state, nodeReducer, dispatch)
    } else if (index == 1) {
        return paymentDetails(state, dispatch)
    } else if (index == 2) {
        return confirmation(state, dispatch)
    } else {
        return (
            <div>Not implemented</div>
        )
    }
}

const paymentInfo = (state, nodeReducer, dispatch) => {
    let nodeList = processSelectItemNode(nodeReducer.nodeList)
    let canGoNext = state.selectedNode != null && state.amount != "" && state.destination != ""
    return (
        <>
            <div className="mt-3 invoice-input-holder p-4">
                <div className="mb-4 nav-title">Pay this invoice</div>
                <div className="col-12 mt-3 mb-3">
                    <Select label={"Node"} onChange={(event) => selectPaymentNode(dispatch, event)} options={nodeList} placeholder='Select a node'/>
                </div>
                <TextArea
                    label={"To"} initialValue={state.destination}
                    onChange={(value) => destinationChanged(dispatch, value)}
                />
                <SatInputConvert
                    label={"Amount"}
                    onChange={(event) => amountChanged(dispatch, event)}
                />
            </div>

            <div className="mt-3 d-flex justify-content-end">
                <PrimaryButton
                    onClick={() => handleNext(dispatch, state)}
                    disabled={!canGoNext}
                    text={"Continue"}/>
            </div>
        </>
    )
}

const paymentDetails = (state, dispatch) => {
    return (
        <>
            <div className="mt-4 mb-4 p-4 payment-detail">
                <div className="mb-4 nav-title text-white">Payment Details</div>

                <div className="d-flex flex-column my-2">
                    <div className="pb-1 dropdown node-balance-title text-white">
                        Invoice Amount
                    </div>
                    <div className="pt-1 node-balance-body text-white">
                        $ {state.amount} sats
                    </div>
                </div>
                <hr className="divider-custom text-white"/>

                <div>
                    <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} className="text-white"
                                     title={"Pay From"}
                                     value={state.selectedNode.lndNodeName}/>
                    <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"To"}
                                     value={state.destination}/>
                    <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Processing Time"}
                                     value={"-[Term]"}/>
                    <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Transaction Fee:"}
                                     value={"x [sats]"}/>
                </div>

            </div>

            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <PrimaryButton onClick={() => sendDirectPayment(dispatch, state)}
                                   text={'Confirm'}/>
                </Box>
            </React.Fragment>
        </>
    )
}

const confirmation = (state, dispatch) => {
    return (
        <>
            <div className="mt-4 confirm-detail-container">
                <div style={{background: state.error ? '#EB4D43' : '#24AB20'}}
                     className="mb-4 d-flex flex-row justify-content-center confirm-detail-holder p-4">
                    <div className="d-flex flex-column">
                        <img
                            src={state.error ? errorIcon : checkIcon}
                        />
                        <div className="align-self-center p-4 text-white">
                            {state.error ? "Payment cannot be processed" : "Payment in progress"}
                        </div>
                    </div>
                </div>
                {state.error ? <InfoPanel error={true} text={state.errorMsg}>

                </InfoPanel> : <></>}

                <div className="p-4 ">
                    <div className="mb-3 nav-title">Channel Details</div>
                    <div className="p-1">
                        <NodeDetailsItem className="text-white" title={"Pay From"}
                                         value={state.selectedNode.lndNodeName}/>
                        <NodeDetailsItem title={"To"} value={state.destination}/>
                        <NodeDetailsItem title={"Amount"} value={state.amount}/>
                        <NodeDetailsItem title={"Processing Time"} value={"~[time]"}/>
                    </div>
                    <hr className="divider-custom"/>

                    <div className="mb-3 nav-title">Fees</div>
                    <div className="p-1">
                        <NodeDetailsItem title={"Transaction Fee:"} value={"$ [x] sats"}/>
                    </div>

                </div>

            </div>
            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <NavLink style={{textDecoration: 'none'}} to={"/send_payment"}
                             onClick={() => handleReset(dispatch)}>
                        <PrimaryButton text={"Done"}/>
                    </NavLink>
                </Box>
            </React.Fragment>
        </>
    )
}

export default PayKeySend;
