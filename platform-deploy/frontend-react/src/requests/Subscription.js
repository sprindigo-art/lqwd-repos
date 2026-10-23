/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

let billingURL = process.env.REACT_APP_BILLING_BASE_URL;
if (!isValidUrl(billingURL)) {
    //path relative to current origin
    billingURL = window.location.origin + billingURL;
}

/* Get Tier Info */
export function requestGetTierInfo() {

    const requestURL = `${billingURL}/api/v1/subscription/products`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        json: true
    });
}

/* Get Current Active Subscriptions */
export function requestGetActiveSubscription() {
    const requestURL = `${billingURL}/api/v1/subscription`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    });
}

/* Get Current Invoice */
export function requestGetCurrentInvoice() {
    const requestURL = `${billingURL}/api/v1/invoices`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    });
}

/* Get Invoices */
export function requestGetInvoices() {
    const requestURL = `${billingURL}/api/v1/invoices`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    });
}

/* Get Invoices - Get Payment History */
export function requestGetPaymentHistory(action) {
    const { payload } = action;

    const requestURL = `${billingURL}/api/v1/payments?startDate=${payload.startDate}&endDate=${payload.endDate}`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    });
}

/* Pay Subscribe Request */
export function requestPaySubscription(action) {

    const { payload } = action;

    const requestURL = `${billingURL}/api/v1/subscription/pay`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            "method": payload.method,
            "invoiceId": payload.invoiceId
        })
    }, false, false);
}

/* Get Payment Node Info */
export function requestGetPaymentNodeInfo() {
    const requestURL = `${billingURL}/api/v1/node/info`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    });
}

/* Cancel Subscription */
export function requestCancelSubscription(action) {

    console.log(action);
    const { payload } = action;
    console.log(payload);
    const requestURL = `${billingURL}/api/v1/subscription?subscriptionId=${payload.subscriptionId}`;

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(requestURL, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
        }
    }, false, false);
}

export function requestGetSubscriptionInvoide(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    const nodeName = encodeURIComponent(payload.nodeName);

    return request(`${billingURL}/api/v1/subscription_request/${nodeName}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/x-www-form-urlencoded",

        },
    });
}