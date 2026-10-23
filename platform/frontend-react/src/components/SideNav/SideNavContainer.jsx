/* eslint-disable */
import React from 'react';
import { useSelector } from 'react-redux';
import SideNavMain from './SideNav'
import BottomNavMain from './BottomNav'
import './SideNav.css'

import dashboardImg from '../../public/icons/sidenav/Dashboard.png';
import sendImg from '../../public/icons/sidenav/Send.png';
import requestImg from '../../public/icons/sidenav/Request.png';
import nodeImg from '../../public/icons/sidenav/Node.png';
import channelImg from '../../public/icons/sidenav/Channel.png';
import transactionsImg from '../../public/icons/sidenav/Transactions.png';
import withdrawImg from '../../public/icons/sidenav/Withdraw.png';

import apiImg from '../../public/icons/sidenav/API.svg';
import manageAPIImg from '../../public/icons/sidenav/ManageAPI.svg';
import requestAccountingImg from '../../public/icons/sidenav/RequestAccounting.svg';
import addUserImg from '../../public/icons/sidenav/AddUser.svg';

import DIAUsageImg from '../../public/icons/sidenav/DIAUsage.svg';


export const navbarList = [
    { title: 'Overview', icon: dashboardImg, shortTitle: 'Overview', path: "/" },
    { title: 'Send LN Payment', icon: sendImg, shortTitle: '', path: "/send-payment" },
    { title: 'Request LN Payment', icon: requestImg, shortTitle: '', path: "/request-payment" },
    { title: 'My Nodes', icon: nodeImg,shortTitle: "My Nodes", path: "/nodes" },
    { title: 'My Channels', icon: channelImg, shortTitle: 'Channels', path: "/channels" },
    { title: 'All Transactions', icon: transactionsImg, shortTitle: 'Txns', path: "/transactions" },
    { title: 'Withdraw', icon: withdrawImg, shortTitle: '', path: "/withdraw" },
];

export const supportNavbarList = [
    { title: 'API Key', icon: apiImg, shortTitle: 'Overview', path: "/support_apikey" },
    { title: 'Manage API', icon: manageAPIImg, shortTitle: 'Send', path: "/support_manage_api" },
    { title: 'Request Accounting', icon: requestAccountingImg, shortTitle: 'Request', path: "/support_request_accounting" },
    { title: 'Share Node Access', icon: addUserImg, shortTitle: 'Share', path: "/share-access" },
    { title: 'DLA Usage', icon: DIAUsageImg, path: "/support_dla_usage" },
];


export default function SideNavContainer() {
    const header = useSelector(state => state.headerReducer);

    return (
        <div className='w-100'>
            <SideNavMain navbarList={header.headerpage == 'Support' ? supportNavbarList : navbarList}></SideNavMain>
            <BottomNavMain navbarList={header.headerpage == 'Support' ? supportNavbarList : navbarList}></BottomNavMain>
        </div>
    );
}
