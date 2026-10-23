/* eslint-disable */
import React from "react";;
import './ChannelTableMobile.css'
import ChannelTableRowMobile from "./ChannelTableRowMobile";

export default function ChannelTableMobile({status, channels, onItemClick, ...rest}) {
  return (
    <div className="channel-table-mobile">
      <div className="channel-table-header-mobile row mx-0">
        <div className="col channel-table-title-mobile flex-direction-row justify-content-start align-self-center">
          Channels
        </div>
        <div className="col channels-table-total-mobile flex-direction-row justify-content-end align-self-center">
          Total: {channels.total}
        </div>
      </div>
      <div className="channel-table-container-mobile">
        {channels.data.length > 0 ?
          <ChannelTableRowMobile channels={channels.data} showChannelDetails={onItemClick} />
          :
          <div className="d-flex flex-row justify-content-center channel-table-empty-container-mobile">
            <div className="d-sm-flex flex-column justify-content-center align-items-center">
              <div className="d-flex flex-column">
                <div className="channel-table-empty-title-mobile m-1">
                  No channels found
                </div>
                <div className="channel-table-empty-text-mobile">
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