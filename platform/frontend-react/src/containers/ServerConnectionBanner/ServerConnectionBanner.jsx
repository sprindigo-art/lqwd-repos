/* eslint-disable */
import React from 'react';
import './ServerConnectionBanner.css'
import { useSelector, useDispatch } from 'react-redux';



const ServerConnectionBanner = () => {
    const server = useSelector(state => state.ServerConnectionBannerReducer);

    let classname  = 'status-banner ' + (server.connected ? ' d-none': ' ');
    return (
        <div className={classname} >
            Disconnected
        </div>
    );
};

export default ServerConnectionBanner;
