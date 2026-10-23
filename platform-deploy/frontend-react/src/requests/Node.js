/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestGetUserNodes() {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lndnode/getlist`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestCreatePersonalLNDNode(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const username = JSON.parse(window.localStorage.getItem('username'));

    const { password, lndNetwork, breezLnd, alias, keySendEnabled, passphrase, isNonCustodial, routingNode } = payload;


    return request(`${baseURL}/kubernetes/lnd_node/create`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
        json: true,
        body: JSON.stringify({
            username,
            password,
            lndNetwork: lndNetwork.toUpperCase(),
            routingNode,
            watchtower: false,
            breezLnd,
            alias,
            walletPassword: password,
            keySendEnabled,
            ...(passphrase != undefined && { passphrase: passphrase }),
            isNonCustodial,
        }),
    });
}

export function requestCreatePersonalLNDNodeV2(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    const { password, lndNetwork, breezLnd, alias, keySendEnabled, passphrase, isNonCustodial, routingNode, paymentMethod, productId, planId, subscription } = payload;


    return request(`${baseURL}/api/v1/node`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
        json: true,
        body: JSON.stringify({
            password,
            lndNetwork: lndNetwork.toUpperCase(),
            routingNode,
            watchtower: false,
            alias,
            keySendEnabled,
            ...(passphrase != undefined && { passphrase: passphrase }),
            isNonCustodial,
            paymentMethod,
            productId,
            planId,
            subscription,
        }),
    });
}

export function requestGetNodeInfo(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const nodeName = encodeURIComponent(payload.nodeName);

    return request(`${baseURL}/api/v1/lnd_details/node_info?lndname=${nodeName}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestCreateDepositAddress(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { nodeName, password, passphrase } = payload;


    return request(`${baseURL}/api/v1/lnd_address/${nodeName}/new_address`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            "Accept": "application/json"
        },
        body: new URLSearchParams({
            password: password,
            ...(passphrase != undefined && { passphrase: passphrase }),
        }),
    }, false, false);
}

export function requestDestroyLNDNode(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const username = JSON.parse(window.localStorage.getItem('username'));

    const { password, lndname, force, passphrase } = payload;


    return request(`${baseURL}/kubernetes/lndnode/destroy`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
        json: true,
        body: JSON.stringify({
            password,
            lndname,
            ...(passphrase != undefined && { passphrase: passphrase }),
            force,
        }),
    });
}

export function requestRestartLNDNode(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { lndname, passphrase, password, action } = payload;


    return request(`${baseURL}/kubernetes/lnd_node/restart_lnd`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
        json: true,
        body: JSON.stringify({
            password,
            lndname,
            ...(passphrase != undefined && { passphrase: passphrase }),
            action
        }),
    });
}

export function requestGetSeeds(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const nodeName = encodeURIComponent(payload.node.lndNodeName);

    return request(`${baseURL}/lnd/getseed?lndname=${nodeName}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/x-www-form-urlencoded",

        },
    });
}

export function requestConfirmSeeds(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { lndNodeName } = payload.node;


    return request(`${baseURL}/lnd/setrunning`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
        json: true,
        body: JSON.stringify({
            lndname: lndNodeName,
        }),
    });
}