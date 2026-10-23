/* eslint-disable */
import React from 'react';
import ChannelBalance from '../ChannelBalance/ChannelBalance'
import ChannelStatus from '../ChannelStatus/ChannelStatus'

export default function DashboardChannel({ prop, showChannelDetails }) {



    return (
        <div className="border-0" role="button" onClick={() => showChannelDetails(prop.channelId)}>
            <div className="container">
                <div className="channel-summary-container row">
                    <div className="col-12 col-md-6 my-2">
                        <div className="p-2 title">
                            {prop.channelId}
                        </div>
                        <ChannelStatus status={prop.type} ></ChannelStatus>

                    </div>
                    <div className="col-12 col-md-6 my-2">
                        <ChannelBalance remoteBalance={prop.remoteBalance ? prop.remoteBalance : 0}
                                        localBalance={prop.localBalance ? prop.localBalance : 0}
                        currency={'sats'}/>
                    </div>
                </div>
            </div>
        </div>);
}
