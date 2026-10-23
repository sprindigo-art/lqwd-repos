/* eslint-disable */
import React from "react";
import ChannelTableItem from "./ChannelTableItem";
import './ChannelTable.css';

export default function ChannelTableRow({channels, classNames, showChannelDetails}) {
  return(
    <div className="channel-table-row">
    {channels.map((item, num) => (
        <ChannelTableItem key={num} chanId={(item.channelId != null) ? item.channelId : item.channelPoint.substring(0, 20)+"..."} localBalance={item.localBalance} remoteBalance={item.remoteBalance} status={(item.status != null) ? item.status : item.type} showChannelDetails={() => showChannelDetails(item)}></ChannelTableItem>
      ))}
    </div>
  );
}