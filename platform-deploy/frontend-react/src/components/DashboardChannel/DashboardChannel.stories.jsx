import React from 'react';
import DashboardChannel from './DashboardChannel';

export default {
    title: 'LQWD Dashboard/Dashboard Channel',
    component: DashboardChannel,
};

export const pending = () => {
    const prop = {
        channelId: '12345623423',
        title: "SOT corp: 1 time",
        remoteBalance: 0,
        localBalance: 500000,
        status: 'PENDING_OPEN_CHANNEL',
        type: 'PENDING_OPEN_CHANNEL',
        currency: "sats",
        statusColor: '#FBCE8B',
    }
    return (
        <div>
            <DashboardChannel prop={prop}/>
        </div>
    );
};

export const remote = () => {
    const prop = {
        channelId:"123456789",
        title: "LAO Inc - 1 year term",
        remoteBalance: 1000000,
        localBalance: 500000,
        status:"ACTIVE_CHANNEL",
        type:"ACTIVE_CHANNEL",
        currency: "sats",
        statusColor: '#B7F6B6',
    }
    return (
        <div>
            <DashboardChannel prop={prop}/>
        </div>
    );
};
