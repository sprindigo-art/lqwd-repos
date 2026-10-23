/* eslint-disable */
import React from 'react';
import ChannelStatus from '../ChannelStatus/ChannelStatus'

export default function ChannelDetailsHeader({channelName, status }) {
  return (
    <div className='d-flex flex-row'>
        <div className='channel-details-title'>{channelName}</div>
        <div><ChannelStatus status={status}></ChannelStatus></div>
    </div>
  );
}
