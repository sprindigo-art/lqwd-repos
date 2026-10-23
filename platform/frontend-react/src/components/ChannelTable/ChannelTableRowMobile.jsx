/* eslint-disable */
import React from "react";
import './ChannelTableMobile.css';
import ChannelTableItemMobile from "./ChannelTableItemMobile";

export default function ChannelTableRowMobile({channels, classNames, showChannelDetails}) {
  return(
    <div className="channel-table-row-mobile">
      {channels.map((item, num) => (
        <ChannelTableItemMobile key={num}
                                chanId={(item.channelId != null) ? item.channelId : item.channelPoint.substring(0, 20)+"..."}
                                localBalance={item.localBalance}
                                remoteBalance={item.remoteBalance}
                                status={(item.status != null) ? item.status : item.type}
                                showChannelDetails={() => showChannelDetails(item)}>
        </ChannelTableItemMobile>
      ))}
    </div>
  );
}