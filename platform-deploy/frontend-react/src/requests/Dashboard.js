/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}


export function requestGetHTLCEvents(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const start = encodeURIComponent(payload.startDate);
    const end = encodeURIComponent(payload.endDate);

    return request(`${baseURL}/api/v1/htlc_events?startDate=${start}&endDate=${end}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestNodeBalanceHistory(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const start = encodeURIComponent(payload.startDate);
    const end = encodeURIComponent(payload.endDate);

    return request(`${baseURL}/api/v1/lnd_details/node_balances?startDate=${start}&endDate=${end}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestTotalNodeBalance() {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/api/v1/lnd_details/total_node_balance`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}



export function requestGetNodeDetail(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lnd/v1/getinfo`, {
        method: 'GET',
        headers: {
            lndname: payload.nodeName,
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestGetNodeBalance(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lnd/v1/balance/blockchain`, {
        method: 'GET',
        headers: {
            lndname: payload.nodeName,
            Authorization: `Bearer ${token}`
        },
    });
}

export function requestGetNodeChannels(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/api/v1/user_lnd_channels?lndname=${payload.nodeName}&types=ACTIVE_CHANNEL,OPEN_CHANNEL,PENDING_OPEN_CHANNEL,INACTIVE_CHANNEL&pageSize=20`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`
        },
    });
}


export function requestGetBTCRates(){
    return request('https://blockchain.info/ticker', {
        method: 'GET',
        headers: {}
    });
}