/* eslint-disable */

import {
    SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST,
    SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_FAIL,
    SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_SUCCESS,
    SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS,
    SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_FAIL,
    SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_SUCCESS,
    SUBSCRIPTION_GET_BTC_ADDRESS,
    SUBSCRIPTION_GET_BTC_ADDRESS_FAIL,
    SUBSCRIPTION_GET_BTC_ADDRESS_SUCCESS,
    SUBSCRIPTION_GET_CURRENT_INVOICE,
    SUBSCRIPTION_GET_CURRENT_INVOICE_FAIL,
    SUBSCRIPTION_GET_CURRENT_INVOICE_SUCCESS,
    SUBSCRIPTION_GET_LN_INVOICE,
    SUBSCRIPTION_GET_LN_INVOICE_FAIL,
    SUBSCRIPTION_GET_LN_INVOICE_SUCCESS,
    SUBSCRIPTION_GET_PAYMENT_HISTORY,
    SUBSCRIPTION_GET_PAYMENT_HISTORY_FAIL,
    SUBSCRIPTION_GET_PAYMENT_HISTORY_SUCCESS,
    SUBSCRIPTION_GET_TIERS,
    SUBSCRIPTION_GET_TIERS_FAIL,
    SUBSCRIPTION_GET_TIERS_SUCCESS,
    SUBSCRIPTION_PAY_RENEWAL,
    SUBSCRIPTION_PAY_RENEWAL_FAIL,
    SUBSCRIPTION_PAY_RENEWAL_SUCCESS
} from "./SubscriptionConstants";

export const initialState = {
    error: false,
    errorMsg: null,
    loading: false,
    pending: false,

    invoiceData: null,
    lnInvoice: {},
    btcAddress: {},
    activeSubscriptions: [],
    currentInvoice: {
        invoiceId: 0,
        data: [],
        tax: null,
        totalAmount: 0,
    },
    paymentHistory: [],

    response: {},
    currentTier: {},
    tiers: {
        data: [],
    },
    subscriptions: [],
}

const parseSubscription = rawData => {
    // sort by creation date
    let sortedRawData = rawData.sort(function(a, b) {
        return Number.parseInt(a.product.id) - Number.parseInt(b.product.id);
    });
    const t = [];
    sortedRawData.forEach(item => {
        const i = {};
        i.id = item.product.id;
        i.price = `$${item.plans[0].price} USD`;
        i.period = item.plans[0].frequency.toLowerCase() == "monthly" ? "month" : item.plans[0].frequency.toLowerCase() == "yearly" ? "year" : item.plans[0].frequency.toLowerCase();
        i.name = item.product.productName;
        i.features = JSON.parse(item.product.description);
        i.rawdata = item;
        t.push(i);
    });
    return t;
};

export default function subscriptionReducer(state = initialState, action) {
    switch (action.type) {
        case SUBSCRIPTION_GET_TIERS:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_TIERS_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                tiers: action.payload.response,
                subscriptions: parseSubscription(action.payload.response.data),
            };
        case SUBSCRIPTION_GET_TIERS_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                activeSubscriptions: action.payload.response.data
            };
        case SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_GET_CURRENT_INVOICE:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_CURRENT_INVOICE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                currentInvoice: action.payload.response.data
            };
        case SUBSCRIPTION_GET_CURRENT_INVOICE_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_GET_PAYMENT_HISTORY:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_PAYMENT_HISTORY_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                paymentHistory: action.payload.response.data
            };
        case SUBSCRIPTION_GET_PAYMENT_HISTORY_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_PAY_RENEWAL:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_PAY_RENEWAL_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                invoiceData: action.payload.response.data
            };
        case SUBSCRIPTION_PAY_RENEWAL_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                response: action.payload.response
            };
        case SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_GET_LN_INVOICE:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_LN_INVOICE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                lnInvoice: action.payload.response
            };
        case SUBSCRIPTION_GET_LN_INVOICE_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };

        case SUBSCRIPTION_GET_BTC_ADDRESS:
            return {
                ...state,
                loading: true,
            };
        case SUBSCRIPTION_GET_BTC_ADDRESS_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                errorMsg: '',
                btcAddress: action.payload.response
            };
        case SUBSCRIPTION_GET_BTC_ADDRESS_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        default:
            return {
                ...state,
            };
    }
}