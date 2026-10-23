/* eslint-disable */
import React, { useEffect, useState } from "react";
import './PayInvoice.css';
import TransactionEmpty from "../../components/Transaction/TransactionEmpty";
import TextArea from "../../components/Basic/TextArea";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import backIcon from '../../public/icons/general/png/Back.png'
import {Box, Step, StepLabel, Stepper} from "@mui/material";
import NodeDetailsItem from "../../components/NodeDetails/NodeDetailsItem";
import checkIcon from '../../public/icons/general/svg/check.svg'
import errorIcon from '../../public/icons/general/svg/error.svg'
import {useDispatch, useSelector} from "react-redux";
import processImg from "../../public/icons/general/svg/loader.svg";
import { useLocation, useNavigate } from "react-router-dom";

import {
    sendPaymentActiveStep,
    sendPaymentDecodeInvoice,
    sendPaymentQueryRoute, sendPaymentPay, sendPaymentReset,
    sendPaymentSelectNode, sendPaymentShowStep,
    sendPaymentUpdateInvoice, sendPaymentQueryRouteSuccess, sendPaymentQueryRouteFailed, sendPaymentToggleAuth
} from "./PayInvoiceActions";
import InfoPanel from "../../components/InfoPanel/InfoPanel";
import TransactionFeeRates from "../../components/Node/TransactionFeeRates/TransactionFeeRates";
import {getTransaction} from "../../utils/transactionUtil";
import TransactionRow from "../../components/Transaction/TransactionRow";
import {processSelectItemNode} from "../../utils/utils";
import NodeSelect from "../../components/Basic/NodeSelect";
import CopyText from "../../components/CopyText/CopyText";
import AuthorizeModal from "../../components/Auth/AuthorizeModal/AuthorizeModal";
import { requestQueryRoute } from "../../requests/Payment";


const steps = ['Enter Invoice', 'Create Channel', 'Verify information', 'Confirmation'];


const handleNext = (dispatch, state) => {
    dispatch(sendPaymentActiveStep(state.activeStep + 1));
}

const handleReset = (dispatch) => {
    dispatch(sendPaymentShowStep(false))
    dispatch(sendPaymentActiveStep(0))
    dispatch(sendPaymentReset())
};

const goToChannelPage = (dispatch) => {
    handleReset(dispatch);
    window.location.href = '/channels';
};

const handleNextInvoiceDetail = (dispatch, state) => {
    console.log("selected node", state.selectedNode)
    if(state.selectedNode == null)
        return

    requestQueryRoute({
        "pubKey" : state.decodedInvoice.destination,
        "amount" : state.decodedInvoice.num_satoshis,
        "nodeName" : state.selectedNode.lndNodeName
    }).then(function(response){
        if (response.routes == null){
            dispatch(sendPaymentActiveStep(state.activeStep + 1));
        }else{
            dispatch(sendPaymentQueryRouteSuccess(response));
            dispatch(sendPaymentActiveStep(state.activeStep + 2));
        }
    }).catch(function(error){
        console.log(error);
        dispatch(sendPaymentQueryRouteFailed(error))
        dispatch(sendPaymentActiveStep(state.activeStep + 1));
    });
}

const doPayment = (dispatch, state) => {
    console.log(state);
    // if (state.channel == null) {
    //     const req = {
    //         "pubKey": state.decodedInvoice.destination,
    //         "nodeAddress": state.selectedNode.privateAddress,
    //         "lndname": state.selectedNode.lndNodeName,
    //         "remoteAddress": state.channelData.remoteAddr,
    //         "satPerVByte": state.channelData.satPerVByte,
    //         "privateChannel": state.channelData.private,
    //         "capacity": state.channelData.amount
    //     }
    //
    //     dispatch(sendPaymentOpenChannel(req, state.invoice, state.selectedNode.lndNodeName))
    //
    // } else {
        dispatch(sendPaymentPay(state.invoice, state.selectedNode.lndNodeName, state.password, state.passphrase))
    // }

}

// const handleChannelDataChange = (state, dispatch, event) => {
//     dispatch(sendPaymentChannelDataChanged({
//         ...state.channelData,
//         [event.target.name]: event.target.value
//     }))
// };

const handleStepperNav = (index, dispatch, state) => {
    if (state.activeStep != index && state.activeStep > index) {
        dispatch(sendPaymentActiveStep(index));
    }
}

const PayInvoice = () => {

    const selectPaymentNode = (value) => {
        dispatch(sendPaymentSelectNode(JSON.parse(value)))
    }

    const paymentRequestChange = (value) => {
        dispatch(sendPaymentUpdateInvoice(value))
    }

    const dispatch = useDispatch();

    const payInvoiceState = useSelector(state => state.payInvoiceReducer);
    const dashboardState = useSelector(state => state.dashboardReducer);
    const nodeReducer = useSelector(state => state.nodeReducer);
    const shareNodeReducer = useSelector(state => state.shareNodeAccessReducer)

    const search = useLocation().search;

    const setInvoiceFromParam = () => {
        const invoice = new URLSearchParams(search).get("invoice");
        dispatch(sendPaymentUpdateInvoice(invoice))
    }


    const showSteps = () => {
        if (payInvoiceState.decodedInvoice == null && !payInvoiceState.loading) {
            dispatch(sendPaymentDecodeInvoice(payInvoiceState.invoice, payInvoiceState.selectedNode.lndNodeName))
        } else {
            dispatch(sendPaymentShowStep(true));
        }
    };

    useEffect(() => {
        setInvoiceFromParam()
        handleReset(dispatch)
    }, [dispatch]);

    let transactions = getTransaction(dashboardState.htlc)
    let nodeList = processSelectItemNode(nodeReducer.nodeList)
    let sharedNodeList = processSelectItemNode(nodeReducer.sharedNodeList)

    const navigate = useNavigate();
    const cancelPayment = () => {
        navigate("/send-payment");
    }

    return (
        <div className="h-100">
            <div className="container-fluid dashboard-container h-100">
                <div className="row h-100">

                    <div className="d-sm-flex flex-column col-12 col-lg-9 px-5 pt-5">
                        <div className="d-flex">
                            <div className="align-self-center" onClick={cancelPayment}>
                                <img
                                  src={backIcon}
                                />
                            </div>
                            <div className="my-node-title">Pay Invoice</div>
                        </div>

                        {!payInvoiceState.showStep ?
                          <div>
                                <div className="mt-3 invoice-input-holder p-4">
                                    <div className="mb-4 nav-title">Pay this invoice</div>
                                    <div className="col-12 mt-3 mb-3">

                                        <NodeSelect label={"Node"} onChange={selectPaymentNode} options={nodeList.concat(sharedNodeList)} placeholder={'Select a node'}/>

                                    </div>
                                    <TextArea
                                        label={"Invoice #ß"}
                                        initialValue={payInvoiceState.invoice}
                                        onChange={paymentRequestChange}
                                    />
                                </div>

                                <div className="mt-3 d-flex justify-content-end">
                                    <PrimaryButton
                                        icon={payInvoiceState.loading ? <img src={processImg} className='rotate'/> : ""}
                                        onClick={showSteps}
                                        disabled={(payInvoiceState.selectedNode == null
                                            || payInvoiceState.invoice == "" || payInvoiceState.loading)}
                                        text={payInvoiceState.loading ? "Processing..." : "Continue"}/>
                                </div>
                            </div> :

                            <Box sx={{width: '100%'}} className="mt-5">
                                <Stepper activeStep={payInvoiceState.activeStep}>
                                    {steps.map((label, index) => {
                                        const stepProps = {};
                                        const labelProps = {};
                                        return (
                                            <Step onClick={() => handleStepperNav(index, dispatch, payInvoiceState)}
                                                  key={label} {...stepProps}>
                                                <StepLabel {...labelProps}>{label}</StepLabel>
                                            </Step>
                                        );
                                    })}
                                </Stepper>

                                {showPageBasedOnIndex(payInvoiceState.activeStep, payInvoiceState, dispatch)}

                            </Box>}

                    </div>

                    <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
                        {payInvoiceState.activeStep == 1 ? <TransactionFeeRates></TransactionFeeRates>
                            : <>
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
                                    : ""}</>}


                    </div>
                </div>
            </div>
        </div>
    );
};

const showPageBasedOnIndex = (index, state, dispatch) => {
    console.log(index, state);
    if (index == 0) {
        return invoiceDetails(state, dispatch)
    } else if (index == 1) {
        return createChannel(state, dispatch)
    } else if (index == 2) {
        return verifyDetails(state, dispatch)
    } else if (index == 3) {
        return confirmDetails(state, dispatch)
    } else {
        return (
            <div>Not implemented</div>
        )
    }
}

const invoiceDetails = (state, dispatch) => {
    console.log(state);
    return (
        <>
            <div className="mt-3 invoice-input-holder p-4">
                <div className="mb-4 nav-title">Invoice details</div>
                <div className="d-flex flex-column my-2">
                    <div className="pb-1 dropdown node-balance-title">
                        Invoice Payment Request
                    </div>
                    <div className="pt-1 node-balance-body">
                        <CopyText text={state.invoice == null ? "Could Not Load Payment Request" : state.invoice}/>
                    </div>
                    <div className="pb-1 dropdown node-balance-title">
                        Invoice Amount
                    </div>
                    <div className="pt-1 node-balance-body">
                        {state.decodedInvoice == null ? "0" : state.decodedInvoice.num_satoshis} sats
                    </div>
                </div>

            </div>
            <div className="wave-bottom"/>

            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <PrimaryButton onClick={() => handleNextInvoiceDetail(dispatch, state)}
                                   text={'Continue'}/>
                </Box>
            </React.Fragment>
        </>
    )
}

const createChannel = (state, dispatch) => {
    console.log(state);
    return (
        <>
            <div className="mt-4 invoice-input-holder p-4">
                <div className="mb-4 nav-title">Create a channel with payee</div>
                <div className="pb-1 dropdown node-balance-title">
                    Looks like you don’t have a channel with this payee, create a channel first to proceed.
                </div>
                <br/>

                <PrimaryButton onClick={() => goToChannelPage(dispatch)} text={'Create Channel'}/>

                {/* <div className="channel-form p-3"> */}

                {/*     <div className="col-12 mt-3"> */}
                {/*         <Input label={"Amount"} name={"amount"} */}
                {/*                onChange={(event) => handleChannelDataChange(state, dispatch, event)}/> */}

                {/*     </div> */}

                {/*     <div className="col-12 mt-3"> */}
                {/*         <Input label={"Remote Addr"} name={"remoteAddr"} */}
                {/*                onChange={(event) => handleChannelDataChange(state, dispatch, event)}/> */}

                {/*     </div> */}

                {/*     <div className="col-12 mt-3"> */}
                {/*         <Input label={"Sat Per vByte"} name={"satPerVByte"} */}
                {/*                onChange={(event) => handleChannelDataChange(state, dispatch, event)}/> */}

                {/*     </div> */}
                {/*     <div className="col-4 mt-3"> */}
                {/*         <Switch label={"Set Channel to Private"} name={"private"} */}
                {/*                 onChange={(event) => handleChannelDataChange(state, dispatch, event)}/> */}

                {/*     </div> */}
                {/*     <div className="col-12 mt-3"> */}
                {/*         <Select label={""} onChange={change} */}
                {/*                 options={[{"name": "Advance Settings", "label": "Advance Settings"}]}/> */}
                {/*     </div> */}
                {/* </div> */}

                {/* <div> */}
                {/*     <div className="mb-2 mt-3 nav-title">Remote LND Identity Key</div> */}
                {/*     <div className="pb-1 dropdown node-balance-title"> */}
                {/*         {state.decodedInvoice == null ? "" : state.decodedInvoice.destination} */}
                {/*     </div> */}
                {/*     /!* <div className="mb-2 mt-3 nav-title">Remote Hostname</div> *!/ */}
                {/*     /!* <div className="pb-1 dropdown Node-balance-title"> *!/ */}
                {/*     /!*     Bob *!/ */}
                {/*     /!* </div> *!/ */}
                {/*     /!* <div className="mb-2 mt-3 nav-title">Remote Port</div> *!/ */}
                {/*     /!* <div className="pb-1 dropdown Node-balance-title"> *!/ */}
                {/*     /!*     03121eb7d6cbbe6a49af4b8ca0dee2e2f7 *!/ */}
                {/*     /!* </div> *!/ */}
                {/* </div> */}

            </div>
            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <PrimaryButton onClick={() => handleReset(dispatch)}
                                   text={'Done'}/>
                </Box>
            </React.Fragment>
        </>
    )
}

const toggleShowAuth = (showAuth) => {
    return !showAuth;
}

// const [showAuth, setShowAuth] = useState(false);

const verifyDetails = (state, dispatch) => {

    return (
        <>
            <div className="mt-4 payment-detail-holder">
                <div className="mb-4 p-4 payment-detail">
                    <div className="mb-4 nav-title text-white">Payment Details</div>

                    <div className="d-flex flex-column my-2">
                        <div className="pb-1 dropdown node-balance-title text-white">
                            Invoice Amount
                        </div>
                        <div className="pt-1 node-balance-body text-white">
                            $ {state.decodedInvoice == null ? "0" : state.decodedInvoice.num_satoshis} sats
                        </div>
                    </div>
                    <hr className="divider-custom text-white"/>

                    <>
                        {state.route == null ?
                          <div>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} className="text-white"
                                               title={"Pay From"}
                                               value={state.selectedNode.lndNodeName}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Connected Channel"}
                                               value={"N/A"}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Channel Capacity"}
                                               value={"N/A"}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Success Prob"}
                                               value={"N/A"}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Transaction Fee:"}
                                               value={"N/A"}/>
                          </div>
                          :

                          <div>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} className="text-white"
                                               title={"Pay From"}
                                               value={state.selectedNode.lndNodeName}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Connected Channel"}
                                               value={state.route.routes[0].hops[0].chan_id}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Channel Capacity"}
                                               value={state.route.routes[0].hops[0].chan_capacity}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Success Prob"}
                                               value={state.route.success_prob}/>
                              <NodeDetailsItem titleColor={"#FFFFFF"} valueColor={"#FFFFFF"} title={"Transaction Fee:"}
                                               value={state.route.routes[0].total_fees}/>
                          </div>
                        }
                    </>


                </div>

                <div className="p-4">
                    <div className="mb-4 nav-title">Channel Details</div>

                    <div className="d-flex flex-column my-2">
                        <div className="pb-1 dropdown node-balance-title">
                            Channel
                        </div>
                        <div className="pt-1 node-balance-body">
                            {state.route != null ? state.route.routes[0].hops[0].chan_id : "NA"}
                        </div>
                    </div>

                    <div className="d-flex flex-column my-2">
                        <div className="pb-1 dropdown node-balance-title">
                            Amount
                        </div>
                        <div className="pt-1 node-balance-body">
                            ${state.route != null ? state.route.routes[0].hops[0].chan_capacity : "NA"}
                        </div>
                    </div>

                    <div className="d-flex flex-column my-2">
                        <div className="pb-1 dropdown node-balance-title">
                            Remote LND Identity Key
                        </div>
                        <div className="pt-1 node-balance-body">
                            {state.decodedInvoice == null ? "" : state.decodedInvoice.destination}
                        </div>
                    </div>


                </div>

            </div>
            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <PrimaryButton onClick={() => dispatch(sendPaymentToggleAuth())}
                                   text={'Confirm'}/>
                </Box>
            </React.Fragment>
            <AuthorizeModal
              show={state.showAuth}
              isNonCustodial={true}
              handleConfirm={(password, passphrase) => {
                  state.password = password;
                  state.passphrase = passphrase;

                  dispatch(sendPaymentToggleAuth());
                  doPayment(dispatch, state);
              }}
              handleHide={() => dispatch(sendPaymentToggleAuth())}
              goBack={() => dispatch(sendPaymentToggleAuth())}/>
        </>
    )
}

const confirmDetails = (state, dispatch) => {
    console.log(state);
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
                        <NodeDetailsItem title={"Invoice Amount"}
                                         value={`$ ${state.decodedInvoice == null ? "0" : state.decodedInvoice.num_satoshis} sats`}/>
                        <NodeDetailsItem title={"Pay From"} value={state.selectedNode.lndNodeName}/>
                        <NodeDetailsItem title={"Connected Channel"} value={""}/>
                        <NodeDetailsItem title={"Processing Time"} value={"~[time]"}/>
                    </div>
                    <hr className="divider-custom"/>

                    <div className="mb-3 nav-title">Fees</div>
                    <div className="p-1">
                        <NodeDetailsItem title={"Open Channel Fee:"} value={"$ [x] sats"}/>
                        <NodeDetailsItem title={"Transaction Fee:"} value={"$ [x] sats"}/>
                    </div>

                </div>
                <div className="wave-bottom"/>
            </div>
            <React.Fragment>
                <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
                    <Box sx={{flex: '1 1 auto'}}/>
                    <PrimaryButton text={"Done"} onClick={() => handleReset(dispatch)}/>
                </Box>
            </React.Fragment>
        </>
    )
}

export default PayInvoice;
