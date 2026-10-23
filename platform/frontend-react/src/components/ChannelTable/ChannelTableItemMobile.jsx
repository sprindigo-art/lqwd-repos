/* eslint-disable */
import React from 'react';
import ChannelStatus from "../ChannelStatus/ChannelStatus";
import ChannelBalance from "../ChannelBalance/ChannelBalance";

export default function ChannelTableItemMobile({chanId, localBalance, remoteBalance, status, showChannelDetails}) {

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
          <div className="channel-table-item-closed-mobile">
            <div className="row">
              <div className="col-12">
                <div className="title-closed-mobile">
                  {chanId}
                </div>
              </div>
            </div>
            <div className="row">
              <div className="col-12">
                <ChannelBalance remoteBalance={remoteBalance}
                                localBalance={localBalance}
                                currency={'sats'}
                                chanProgressBg={chanProgressBgClosed}
                                isMobile={true}/>
              </div>
            </div>
          </div>
        </div>
        :
        <div className="container" style={{background: "#FFFFFF", borderRadius: "8px"}}>
          <div className="channel-table-item-mobile">

            <div className="title-mobile flex-column">
              {chanId}
            </div>
            <div className={"flex-column"}>
              <ChannelStatus status={status} isMobile={true} ></ChannelStatus>
            </div>
          </div>
          <div className={"d-flex flex-row"}>
            <ChannelBalance remoteBalance={remoteBalance} localBalance={localBalance}
                            chanProgressBg={chanProgressBgActive}
                            currency={'sats'}/>
          </div>
        </div>
      }

    </div>
  );
}
