/* eslint-disable */
import React from 'react';
import './ChannelStatus.css';

const statusColorMap = {
    "PENDING_OPEN_CHANNEL" : "#FBCE8B",
    "ACTIVE_CHANNEL" : "#B7F6B6",
    "OPEN_CHANNEL": "#B7F6B6",
    "OPEN": "#B7F6B6",
    "INACTIVE_CHANNEL" : "#FF0000",
}

const statusText = {
    "PENDING_OPEN_CHANNEL" : "Pending",
    "ACTIVE_CHANNEL" : "Active",
    "OPEN_CHANNEL": "Active",
    "OPEN": "Active",
    "INACTIVE_CHANNEL" : "Inactive",
}

export default function ChannelStatus({status, className, isMobile}) {

    return (
      <>
          {
              isMobile ?
                <div className={"channel-status-container-mobile " + className}>
                    <svg style={{ color: statusColorMap[status] }} xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
                        <circle cx="4" cy="4.5" r="4" fill="currentColor"/>
                    </svg>
                    {statusText[status]}
                </div>
                :
                <div className={"channel-status-container " + className}>
                    <svg style={{ color: statusColorMap[status] }} xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
                        <circle cx="4" cy="4.5" r="4" fill="currentColor"/>
                    </svg>
                    {statusText[status]}
                </div>
          }
      </>
    );
}
