/* eslint-disable */
import React, { useState } from "react";
import { Modal } from "react-bootstrap";
import './CloseChannel.css';
import InfoPanel from "../InfoPanel/InfoPanel";
import ChannelStatus from "../ChannelStatus/ChannelStatus";
import RadioButton from "../RadioButton/RadioButton";
import Password from "../Basic/Password";
import DangerButton from "../Buttons/DangerButton";
import BasicButton from "../Buttons/BasicButton";
import { myChannelsCloseChannel } from "../../containers/MyChannels/MyChannelsActions";
import { useDispatch } from "react-redux";


export default function CloseChannelModal({ show, handleClose, onBack, channel, dispatch }){

  const [checked, setChecked] = useState(true);

  const [force, setForce] = useState(false);

  const [value, setValue] = useState('');

  const onChange = (val) => {
    setValue(val);
  }

  const handleChange = (checked) => {
    setChecked(!checked);
    setForce(!force);
  };

  const [authorized, setAuthorized] = useState({
    show: false,
  });

  const showAuthorize = () => setAuthorized({
    show: true,
  });

  const hideAuthorize = () => setAuthorized({
    show: false,
  });

  const handleCloseChannel = (value) => {
    dispatch(myChannelsCloseChannel(channel, force, value));
    handleClose();
  };

  return (
    <>
      <Modal centered className="" show={show} size='md' onHide={handleClose}  backdrop='static' keyboard="False">
        <Modal.Header closeButton className="mx-2 cus-header">
          <div id="" className="w-100 flex-column cus-sub-header justify-content-around">
            <div className="d-sm-flex flex-row align-items-center">
              <div className="close-channel-modal-title">
                <div style={{ cursor: 'pointer' }} onClick={onBack}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M9.92902 11.9997L13.75 8.17866C14.164 7.76466 14.164 7.09266 13.75 6.67866C13.336 6.26466 12.664 6.26466 12.25 6.67866L7.63602 11.2927C7.24502 11.6837 7.24502 12.3167 7.63602 12.7067L12.25 17.3207C12.664 17.7347 13.336 17.7347 13.75 17.3207C14.164 16.9067 14.164 16.2347 13.75 15.8207L9.92902 11.9997Z" fill="#4D4D4D"/>
                  </svg>
                </div>
                Close Channel [Name]
              </div>
            </div>
          </div>
        </Modal.Header>
        <Modal.Body className="mx-3">
          <div className="close-channel-modal-body">
            <InfoPanel error={true} text={"Are you sure? Once you close the channel, [name], there's no getting it back."}></InfoPanel>

            <div className="close-channel-modal-body-row-frame">
              <div className="close-channel-modal-body-info-row">
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                  Channel Name
                </div>
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                  {channel.channelId}
                </div>
              </div>
              <div className="close-channel-modal-body-info-row">
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                  Channel ID
                </div>
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                  {channel.channelId}
                </div>
              </div>
              <div className="close-channel-modal-body-info-row">
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                  Channel Status
                </div>
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                  <ChannelStatus status={channel.status} className={"close-channel-channel-status"}></ChannelStatus>
                </div>
              </div>
              <div className="close-channel-modal-body-line"></div>
              <div className="close-channel-modal-body-info-row">
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                  Your Balance
                </div>
                <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                  {parseInt(channel.localBalance).toLocaleString(undefined, {maximumFractionDigits: 2})} sats
                </div>
              </div>
              <div className="close-channel-modal-body-info-row">
              <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                Remote Balance
              </div>
              <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                {parseInt(channel.remoteBalance).toLocaleString(undefined, {maximumFractionDigits: 2})} sats
              </div>
            </div>
              <div className="close-channel-modal-body-line"></div>
              <div className="close-channel-modal-body-info-row">
              <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-key">
                Fee
              </div>
              <div className="col-sm-12 col-md-6 close-channel-modal-body-info-col-val">
                [Estimated Closing Fee] sats
              </div>
            </div>
              <div className="close-channel-modal-body-line"></div>
            </div>

            Choosing Closing Method
            <div className="close-channel-modal-body-info-row close-channel-modal-body-info-close-btns">
              <RadioButton id={"cooperative"} label={"Cooperative Close"} name={"cooperative"} value={"cooperative"} selected={checked} handleChange={() => handleChange(checked)}></RadioButton>
              <RadioButton id={"force"} label={"Force Close"} name={"force"} value={"force"} selected={!checked} handleChange={() => handleChange(checked)}></RadioButton>
            </div>
          </div>
          <div className="close-channel-modal-footer">
            <Password label='Platform Password' errorMsg={'Incorrect password, please try again.'} onChange={onChange}></Password>
            <div className="close-channel-modal-footer-btns">
              <BasicButton text={"Cancel"} onClick={handleClose}></BasicButton>
              <DangerButton text={"Close"} onClick={() => handleCloseChannel(value)}></DangerButton>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}