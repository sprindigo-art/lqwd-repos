/* eslint-disable */
import React from 'react';
import ChannelStatus from "../ChannelStatus/ChannelStatus";
import ChannelBalance from "../ChannelBalance/ChannelBalance";


export default function ChannelTableItem({chanId, localBalance, remoteBalance, status, showChannelDetails}) {

  const chanProgressBgClosed = {
    backgroundColor: "#A5A5A5",
    height: "8px"
  };

  const chanProgressBgActive = {
    backgroundColor: "#009EE2",
    height: "8px"
  };

  return (
    // <div role="button">
    <div role="button" onClick={showChannelDetails}>
      {status === "CLOSED"?
        <div className="container">
          <div className="channel-table-item-closed">
            <div className="row">
              <div className="col-12">
                <div className="title-closed">
                  {chanId}
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-12">
                <ChannelBalance remoteBalance={remoteBalance}
                                localBalance={localBalance}
                                currency={'sats'} chanProgressBg={chanProgressBgClosed}/>
              </div>
            </div>
          </div>
        </div>
        :
        <div className="container">
          <div className="channel-table-item">
            <div className="col-12 col-md-6">
              <div className="title">
                {chanId}
              </div>
              <ChannelStatus status={status} ></ChannelStatus>
            </div>
            <div className="col-12 col-md-6">
              <ChannelBalance remoteBalance={remoteBalance} localBalance={localBalance}
                              chanProgressBg={chanProgressBgActive}
                              currency={'sats'}/>
            </div>
          </div>
        </div>
      }

    </div>
  );
}
