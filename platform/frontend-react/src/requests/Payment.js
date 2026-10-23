/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}



export function requestGetPaymentRequest(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    const paymentRequest = encodeURIComponent(payload.invoice);
    const nodeName = encodeURIComponent(payload.nodeName);

    return request(`${baseURL}/lnd/v1/payreq/${paymentRequest}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "lndname": nodeName
        },
    });
}

export function requestCreateInvoice(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const { password, passphrase } = payload;

    return request(`${baseURL}/lnd/create/invoices/${payload.amount}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': "application/json",
            "Accept": "application/json",
            lndname: payload.nodename,
            "password": password,
            ...(passphrase != undefined && { passphrase: passphrase })
        },
    });
}

export function requestSendInvoiceToEmail(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/api/v1/invoice/send_to_email`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            amount: payload.amount,
            invoiceBase64: payload.invoiceBase64,
            email: payload.emailAddress,
            invoiceAddress: payload.invoiceAddress,
            payRequest: payload.payRequest,
        })
    });
}

export function requestSendKeySendToEmail(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/api/v1/invoice/send_keysend_to_email`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({
            keySendAddress: payload.nodeAddress,
            email: payload.emailAddress,
        })
    });
}

export function requestGetOpenChannel(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    const channelRequest = payload.channelRequest;

    return request(`${baseURL}/api/v1/channel/open_channel`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify(channelRequest)
    }, false, false);
}

export function requestSendPayment(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lnd/v2/router/send`, {
        method: 'POST',
        headers: {
            lndname: payload.nodeName,
            'Content-Type': "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            'password': payload.password,
            ...(payload.passphrase != undefined && { passphrase: payload.passphrase })
        },
        body: JSON.stringify(payload.request)
    }, true);
}

export function requestSendCoins(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    return request(`${baseURL}/lnd/v1/transactions`, {
        method: 'POST',
        headers: {
            lndname: payload.nodeName,
            'Content-Type': "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "password": payload.password,
            ...(payload.passphrase != undefined && { passphrase: payload.passphrase })
        },
        body: JSON.stringify(payload.request)
    }, false, false);
}

export function requestGetInvoices(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    let query = Object.keys(payload)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(payload[k]))
        .join('&');

    let url = `${baseURL}/api/v1/invoices?${query}`


    return request(url, {
        method: 'GET',
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`
        }
    });
}


export function requestFindAvailableChannel(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    const remotePubkey = encodeURIComponent(payload.response.destination);
    const nodeName = encodeURIComponent(payload.nodeName);
    const capacity = encodeURIComponent(payload.response.num_satoshis);

    return request(`${baseURL}/api/v1/channel/available?lndname=${nodeName}&remotePubkey=${remotePubkey}&capacity=${capacity}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "lndname": nodeName
        },
    });
}

export function requestQueryRoute(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/lnd/v1/graph/routes/${payload.pubKey}/${payload.amount}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "lndname": payload.nodeName
        },
    });
}