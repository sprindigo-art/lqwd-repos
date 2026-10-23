/* eslint-disable */
import React, { useState } from "react";

import './MyChannelsCreateChannel.css';
import Switch from "../../components/Basic/Switch";

import backIcon from '../../public/icons/general/svg/Back.svg';

import PrimaryButton from "../../components/Buttons/PrimaryButton";
import TransactionFeeRates from "../../components/Node/TransactionFeeRates/TransactionFeeRates";

import {
  myChannelChangeIndex,
  myChannelsChannelDataChanged,
  myChannelsCreateChannelAction, myChannelsShowAuthorizeModal, selectNode
} from "./MyChannelsActions";

import {Box, Step, StepLabel, Stepper} from "@mui/material";
import Input from "../../components/Basic/Input";
import Select from "../../components/Basic/Select";
import NodeSelect from "../../components/Basic/NodeSelect";
import { getNodeBalance, processSelectItemNode, processSelectItemNodeMyChannels } from "../../utils/utils";
import AuthorizeModal from "../../components/Auth/AuthorizeModal/AuthorizeModal";
import processImg from "../../public/icons/general/svg/loader.svg";
import InfoPanel from "../../components/InfoPanel/InfoPanel";
import nodes from './LqwdNodes.json';
import { Form } from "react-bootstrap";
import { useSnackbar } from "notistack";
import { requestGetOpenChannel } from "../../requests/Payment";
import { enqueueSnackbar } from "../Notifier/NotifierActions";
import NotificationDuration from "../../NotificationDuration";

const myChannelsCreateChannel = ({ state, nodeState, goBack, dispatch }) => {

  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const steps = ['Enter Information', 'Verify information'];

  const myChannelsState = state;

  const hideAuthorize = () =>{
    dispatch(myChannelsShowAuthorizeModal(false))
  }

  const confirmChannelCreation = (password, passphrase) => {

    let req = {
              "pubKey": state.channelData.remotePubkey,
              "nodeAddress": state.selectedNode.privateAddress,
              "lndname": state.selectedNode.lndNodeName,
              "remoteAddress": `${state.channelData.remoteHostname}:${state.channelData.remotePort}`,
              "satPerVByte": state.channelData.satPerVByte,
              "privateChannel": state.channelData.private,
              "capacity": state.channelData.amount,
              "password": password,
              ...(passphrase != undefined && { passphrase: passphrase })
          }

    // dispatch(myChannelsCreateChannelAction(req, password, passphrase))
    requestGetOpenChannel({channelRequest: req})
      .then(function(response){
        if (response.status === 200){
          enqueueSnackbar("Successfully Created Channel",
              { variant: 'success', autoHideDuration: NotificationDuration });
        }else{
          enqueueSnackbar(response.message ? response.message : response.error,
              { variant: 'error', autoHideDuration: NotificationDuration });
        }
      }).catch(function(error){
      enqueueSnackbar(error, { variant: 'error', autoHideDuration: NotificationDuration });
    });

    dispatch(myChannelsShowAuthorizeModal(false))
    dispatch(myChannelChangeIndex(0))
    goBack()

  };

  const showPageBasedOnIndex = (index, state, dispatch, goBack) => {
    if (index == 0) {
      return channelDetails(state, dispatch)
    } else if (index == 1) {
      return channelInfo(state, dispatch, goBack)
    } else {
      return (
        <div>Not implemented</div>
      )
    }
  }

  const selectChannelNode = (value, dispatch) => {
    dispatch(selectNode(JSON.parse(JSON.parse(value).value)))
    setNodeSelected(true)
  }

  const handleChannelDataChange = (state, dispatch, event) => {
    dispatch(myChannelsChannelDataChanged({
      ...state.channelData,
      [event.target.name]: event.target.value
    }))
  };

  const setActiveIndex = (dispatch, index) =>{
    if(index === 0){
      dispatch(myChannelChangeIndex(index))
    }else {
      if (nodeSelected && !amountError){
        dispatch(myChannelChangeIndex(index))
      }
    }
  }

  const showAuthorize = (dispatch, state, goBack) =>{
    if (state.createChannel != null){
      goBack()
      return;
    }
    dispatch(myChannelsShowAuthorizeModal(true))
  }

  const channelInfo = (state, dispatch, goBack) => {
    return(
      <div className="create-channel-form-container mt-5">
        <div className="create-channel-confirmation-panel">
          <div className="create-channel-confirmation">
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Node Connected
              </div>
              <div className="create-channel-confirmation-value">
                {state.selectedNode.lndNodeName} -
                {getNodeBalance(state.selectedNode.lndNodeName, nodeState.nodeInfos).toLocaleString('en-US')} sats
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Amount
              </div>
              <div className="create-channel-confirmation-value">
                {state.channelData.amount} Sats
              </div>
            </div>
            <div className="create-channel-confirmation-line"></div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Remote LND Identity Key
              </div>
              <div className="create-channel-confirmation-value">
                {state.channelData.remotePubkey}
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Remote Hostname
              </div>
              <div className="create-channel-confirmation-value">
                {state.channelData.remoteHostname}
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Remote Port
              </div>
              <div className="create-channel-confirmation-value">
                {state.channelData.remotePort}
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Sat Per vByte
              </div>
              <div className="create-channel-confirmation-value">
                {state.channelData.satPerVByte}
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Private Channel
              </div>
              <div className="create-channel-confirmation-value">
                {(state.channelData.private ? "On" : "Off")}
              </div>
            </div>
            <div className="create-channel-confirmation-line"></div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Open Channel Fee
              </div>
              <div className="create-channel-confirmation-value">
                [X] sats
              </div>
            </div>
            <div className="create-channel-confirmation-row">
              <div className="create-channel-confirmation-label">
                Channel Creation Processing time
              </div>
              <div className="create-channel-confirmation-value">
                ~[X] mins
              </div>
            </div>
          </div>
        </div>
        <div className="create-channel-form-row create-channel-form-submit">
          <PrimaryButton onClick={() => showAuthorize(dispatch, state, goBack)}
                         text={'Done'} />
        </div>
      </div>

    )
  }

  const [nodeSelected, setNodeSelected] = useState(false);

  const [lqwdNodes, setLqwdNodes] = useState(nodes != null ? nodes.nodes : []);

  const [manualEntry, setManualEntry] = useState(true);

  const [amountError, setAmountError] = useState(true);

  const channelDetails = (myChannelsState, dispatch) => {
    console.log(myChannelsState);
    console.log(nodeState);
    let nodeList = processSelectItemNode(myChannelsState.myNodes)
    let sharedNodeList = processSelectItemNode(nodeState.sharedNodeList)

    let nodeListMyChannels = processSelectItemNodeMyChannels(nodeList, nodeState.nodeInfos, false);
    let sharedNodeListMyChannels = processSelectItemNodeMyChannels(sharedNodeList, nodeState.sharedNodeInfos, true)

    const handleLqwdNodeSelect = (state, dispatch, event) => {

      if (event.target.value !== "manual") {
        setManualEntry(false);

        dispatch(myChannelsChannelDataChanged({
          ...myChannelsState.channelData,
          remotePubkey: event.target.value.split("@")[0],
          remoteHostname: event.target.value.split("@")[1].split(":")[0],
          remotePort: event.target.value.split("@")[1].split(":")[1]
        }))

      }else{
        setManualEntry(true);

        dispatch(myChannelsChannelDataChanged({
          ...myChannelsState.channelData,
          remotePubkey: "",
          remoteHostname:"",
          remotePort: ""
        }))
      }
    };

    const getLqwdNodeInfoDiv = (channelData) => {
      return (
        <>
          <div className="col-12 mt-3">
            <div className='text-input'>
              <div className='m-1 input-label'>Remote LND Identity Key</div>
              <div className="input-group">
                <input type="text" name="remotePort" value={channelData.remotePubkey}
                       className="form-control rounded-right" required disabled={true} />
              </div>
            </div>
          </div>

          <div className="col-12 mt-3">
            <div className='text-input'>
              <div className='m-1 input-label'>Remote Host</div>
              <div className="input-group">
                <input type="text" name="remotePort" value={channelData.remoteHostname}
                       className="form-control rounded-right" required disabled={true} />
              </div>
            </div>
          </div>


          <div className="col-12 mt-3">
            <div className='text-input'>
             <div className='m-1 input-label'>Remote Port</div>
              <div className="input-group">
                <input type="text" name="remotePort" value={channelData.remotePort}
                       className="form-control rounded-right" required disabled={true} />
              </div>
            </div>
          </div>
        </>
      );
    };

    const checkAmount = (value, nodeName) => {
      if (value < 10000){
        setAmountError(true);
      } else if (value >= 10000 && value < parseInt(getNodeBalance(nodeName, nodeState.nodeInfos))){
        setAmountError(false);
      }
    }



    return (
      <>
        <div className={"channel-form p-3"}>

          <div className="col-12 mt-3">
            <NodeSelect label={"Node"}  onChange={(v) => selectChannelNode(v, dispatch)}
                        options={nodeListMyChannels.concat(sharedNodeListMyChannels)}
                        placeholder={'Select a node'}/>
          </div>

          <div className="col-12 mt-3">
            <Input placeHolder={"Minimum amount required: 10k sats"}
                   label={"Amount"}
                   initialValue={myChannelsState.channelData.amount}
                   onChange={(event) => {
                     checkAmount(event.target.value, myChannelsState.selectedNode.lndNodeName);
                     handleChannelDataChange(myChannelsState, dispatch, event);
                   }}
                   name={"amount"}
                   error={amountError}
                   errorMsg={"Value must be greater than 10k and less than current node confirmed balance"}/>
          </div>

          <div className="col-12 mt-3">
            <Form.Select aria-label="Default select example" onChange={(v) => handleLqwdNodeSelect(myChannelsState, dispatch, v)}>
              <option value={"manual"}>Select LQwD Node or Enter Manually</option>
              {lqwdNodes.map((item, num) => (<option key={num} value={item.pubkey+"@"+item.externalip+":"+item.port}  >{item.alias} - Minimum Channel Size: {parseInt(item.minChannel).toLocaleString()} sats</option>))}
            </Form.Select>
          </div>

          { manualEntry ?
            <>
              <div className="col-12 mt-3">
                <Input label={"Remote LND Identity Key"} name={"remotePubkey"} placeHolder={"Remote LND Identity Key"}
                       initialValue={myChannelsState.channelData.remotePubkey}
                       onChange={(event) => handleChannelDataChange(myChannelsState, dispatch, event)}/>

              </div>

              <div className="col-12 mt-3">
                <Input label={"Remote Hostname"} name={"remoteHostname"} placeHolder={"Remote Hostname"}
                       initialValue={myChannelsState.channelData.remoteHostname}
                       onChange={(event) => handleChannelDataChange(myChannelsState, dispatch, event)}/>
              </div>

              <div className="col-12 mt-3">
                <Input label={"Remote Port"} name={"remotePort"} placeHolder={"Remote Port"}
                       initialValue={myChannelsState.channelData.remotePort}
                       onChange={(event) => handleChannelDataChange(myChannelsState, dispatch, event)}/>
              </div>
            </>
            :
            <>
              {getLqwdNodeInfoDiv(myChannelsState.channelData)}
            </>

          }



          <div className="col-12 mt-3">
            <Input label={"Sat Per vByte"} name={"satPerVByte"}
                   initialValue={myChannelsState.channelData.satPerVByte}
                   onChange={(event) => handleChannelDataChange(myChannelsState, dispatch, event)}/>

          </div>

          <div className="col-4 mt-3">
            <Switch label={"Set Channel to Private"} name={"private"}
                    value={myChannelsState.channelData.private}
                    onChange={(event) => handleChannelDataChange(myChannelsState, dispatch, event)}/>

          </div>

          <div className="col-12 mt-3">
            <Select label={""}
                    options={[{"name": "Advance Settings", "label": "Advance Settings"}]}/>
          </div>
        </div>
        <React.Fragment>
          <Box sx={{display: 'flex', flexDirection: 'row', pt: 2}}>
            <Box sx={{flex: '1 1 auto'}}/>
            <PrimaryButton icon={myChannelsState.loading ? <img src={processImg} className='rotate'/> : ""}
                           disabled={myChannelsState.loading || amountError || !nodeSelected} onClick={() => setActiveIndex(dispatch, 1)}
                           text={'Confirm & Create'}/>
          </Box>
        </React.Fragment>
      </>
    )
  }

  return (

      <div className="h-100">
        <div className="container-fluid dashboard-container h-100">
          <div className="row h-100">

            <div className="d-sm-flex flex-column col-12 col-lg-9 px-5 pt-5">

              <div className="d-flex" onClick={goBack}>
                <div className="align-self-center">
                  <img
                      src={backIcon}
                  />
                </div>
                <div className="my-node-title">Create Channel</div>
              </div>

              <Box sx={{width: '100%'}} className="mt-5">
                {myChannelsState.error ?

                    <InfoPanel warn={true} text={myChannelsState.errorMsg.message}/>
                    :<></>
                }

                {myChannelsState.createChannel ?

                    <InfoPanel warn={false} text={"Channel creation in progress"}/>
                    :<></>
                }

                <Stepper activeStep={myChannelsState.activeIndexCreateChannel}>
                  {steps.map((label, index) => {
                    const stepProps = {};
                    const labelProps = {};
                    return (
                        <Step onClick={() => setActiveIndex(dispatch,index)}
                              key={label} {...stepProps}>
                          <StepLabel {...labelProps}>{label}</StepLabel>
                        </Step>
                    );
                  })}
                </Stepper>

                {showPageBasedOnIndex(myChannelsState.activeIndexCreateChannel, myChannelsState, dispatch, goBack)}

              </Box>

            </div>

            <div className="dashboard-transactions d-none col-lg-3 d-md-flex flex-column pt-2">
              <TransactionFeeRates></TransactionFeeRates>
            </div>

          </div>
        </div>

         <AuthorizeModal show={state.showAuthorize} handleConfirm={confirmChannelCreation} handleHide={hideAuthorize} goBack={hideAuthorize} isNonCustodial={state.selectedNode.isNonCustodial}/>

      </div>


  );
}

export default myChannelsCreateChannel;