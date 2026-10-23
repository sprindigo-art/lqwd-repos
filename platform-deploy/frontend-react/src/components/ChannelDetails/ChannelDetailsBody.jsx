/* eslint-disable */
import React from 'react';
import ChannelBalance from '../ChannelBalance/ChannelBalance'
import TextPanel from '../InfoPanel/InfoPanel'
import ChannelDetailsSection from './ChannelDetailsSection'
import ChannelDetailsBalanceSummary from './ChannelDetailsBalanceSummary'
import WasteIcon from '../../public/icons/general/png/Waste.png';
import Moment from "moment";

function timeSince(date) {

    let seconds = Math.floor((new Date() - date) / 1000);
    const divisors = [31536000, 2592000, 86400, 3600, 60, 1];
    const description = ["years", "months", "days", "hours", "mins", "secs"];
    const result = [];

    let interval = seconds;

    for (let i = 0; i < divisors.length; i++) {
        interval = Math.floor(seconds / divisors[i])
        if (interval > 1) {
            result.push(interval + " " + description[i])
        }
        seconds -= interval * divisors[i]
    }

    return result.join(" ")
}

export default function ChannelDetailsBody({ data, connectedNode, handleCloseAction, isMobile }) {

  let updated = timeSince(new Date(data.dateModified))

  return (
    <div>
      <div className='d-flex flex-xl-row flex-lg-row flex-md-column flex-sm-column flex-xxl-row flex-column justify-content-between'>
        <span id='channel-connected-to-text' style={{overflow:'hidden'}}>Connecting to <span style={{ fontWeight: 'bold' }}>{connectedNode}</span></span>
        <span id='channel-last-updated'>Last Updated <span style={{ fontWeight: 'bold' }}>{Moment(data.dateModified).format("MMM DD, YYYY @ HH:SS Z")}</span></span>
      </div>

      <ChannelDetailsSection data={data}></ChannelDetailsSection>
      <ChannelBalance {...data} ></ChannelBalance>
      <TextPanel warn={true} text="The payment channel balance may fluctuate due to routing nodes. This will not impact your total combined node balance."></TextPanel>
      <div className='container'>
        <div className='row'>
          <div className='col-12 col-md-5 order-md-2'><ChannelDetailsBalanceSummary data={data}></ChannelDetailsBalanceSummary></div>
          {isMobile ? <></> : <div onClick={handleCloseAction} className='delete-icon col-12 col-md-7 order-md-1'><img src={WasteIcon}></img></div>}
        </div>
      </div>

    </div>
  );
}
