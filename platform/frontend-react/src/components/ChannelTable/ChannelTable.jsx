/* eslint-disable */
import React from "react";
import ChannelTableRow from "./ChannelTableRow";
import './ChannelTable.css'

export default function ChannelTable({status, channels, onItemClick, ...rest}) {
  return (
      <div className="channel-table">
        <div className="channel-table-header row mx-0">
          <div className="col channel-table-title flex-direction-row justify-content-start align-self-center">
            Channels
          </div>
          <div className="col channels-table-total flex-direction-row justify-content-end align-self-center">
            Total: {channels.total}
          </div>
        </div>
        <div className="channel-table-container">
          {channels.data.length > 0 ?
            <ChannelTableRow channels={channels.data} showChannelDetails={onItemClick} />
            :
              <div className="d-flex flex-row justify-content-center channel-table-empty-container">
                <div className="d-sm-flex flex-column justify-content-center align-items-center">
                    <svg width="150" height="129" viewBox="0 0 150 129" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M149.5 64.5C149.5 100.951 108.951 129 72.5 129C36.0492 129 0 108.451 0 72C0 35.5492 27.0492 0 63.5 0C99.9508 0 149.5 28.0492 149.5 64.5Z" fill="#E8ECF3"/>
                        <path d="M87.5 44C83.1113 44 79.5 47.6113 79.5 52C79.5 53.1065 79.7467 54.1487 80.1578 55.0999L71.2577 64H59.8742C58.6784 61.0913 55.8315 59 52.5 59C48.1113 59 44.5 62.6113 44.5 67C44.5 71.3887 48.1113 75 52.5 75C55.8315 75 58.6784 72.9087 59.8742 70H71.2577L80.1578 78.9001C79.7467 79.8513 79.5 80.8934 79.5 82C79.5 86.3887 83.1113 90 87.5 90C91.8887 90 95.5 86.3887 95.5 82C95.5 77.6113 91.8887 74 87.5 74C86.3934 74 85.3513 74.2467 84.4001 74.6578L76.7423 67L84.4001 59.3422C85.3513 59.7533 86.3934 60 87.5 60C91.8887 60 95.5 56.3887 95.5 52C95.5 47.6113 91.8887 44 87.5 44ZM87.5 50C88.6342 50 89.5 50.8658 89.5 52C89.5 53.1342 88.6342 54 87.5 54C86.3658 54 85.5 53.1342 85.5 52C85.5 50.8658 86.3658 50 87.5 50ZM52.5 65C53.6342 65 54.5 65.8658 54.5 67C54.5 68.1342 53.6342 69 52.5 69C51.3658 69 50.5 68.1342 50.5 67C50.5 65.8658 51.3658 65 52.5 65ZM87.5 80C88.6342 80 89.5 80.8658 89.5 82C89.5 83.1342 88.6342 84 87.5 84C86.3658 84 85.5 83.1342 85.5 82C85.5 80.8658 86.3658 80 87.5 80Z" fill="#B7C3DA" stroke="#B7C3DA"/>
                    </svg>
                    <div className="d-flex flex-column">
                        <div className="channel-table-empty-title m-1">
                            No channels found
                        </div>
                        <div className="channel-table-empty-text">
                            Looks like you haven’t created a channel with others yet.
                        </div>
                    </div>

                </div>
              </div>
          }
        </div>
      </div>
  );
}