/* eslint-disable */

import {
    GET_HTLC_EVENT,
    GET_HTLC_EVENT_FAILED,
    GET_HTLC_EVENT_SUCCESS,
    CHANGE_BALANCE,
    CHANGE_CURRENCY,
    SELECT_NODE,
    GET_NODE_BALANCE,
    GET_NODE_BALANCE_FAILURE,
    GET_NODE_BALANCE_SUCCESS,
    GET_NODE_CHANNELS,
    GET_NODE_CHANNELS_FAILURE,
    GET_NODE_CHANNELS_SUCCESS,
    GET_BALANCE_HISTORY,
    GET_BALANCE_HISTORY_FAILED,
    GET_BALANCE_HISTORY_SUCCESS,
    GET_TOTAL_BALANCE,
    GET_TOTAL_BALANCE_FAILED,
    GET_TOTAL_BALANCE_SUCCESS, GET_BTC_RATE_FAILURE, GET_BTC_RATE_SUCCESS, GET_BTC_RATE,
} from './DashboardConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    htlc: [],
    error: false,
    errorMsg: null,
    loading: true,
    currency: {
        code: 'sats',
        name: 'Satoshis',
        rate: 1,
    },
    btcRates: null,
    currencies: {
        USD: {
            code: 'USD',
            name: 'United states dollar',
            rate: 0.00000001,
        },
        Sats: {
            code: 'sats',
            name: 'Satoshis',
            rate: 1,
        },
        BTC: {
            code: 'BTC',
            name: 'Bitcoin',
            rate: 0.00000001,
        },
    },
    balance: 0,
    received: 0,
    sent: 0,
    balanceHistory: [],
    selectedNodeDetail: {},
    selectedNodeBalance: {},
    selectedNodeChannels: [],
    totalChannels: 0
};

function getSentAndReceivedTrx(data) {
    let sent = 0;
    let received = 0;

    for (let i = 0; i < data.length; i += 1) {
        if (data[i].eventType === 'SEND') {
            if (data[i].outgoingAmtMsat != null)
                sent += data[i].outgoingAmtMsat / 1000;
        } else if (data[i].incomingAmtMsat != null)
            received += data[i].incomingAmtMsat / 1000;
    }

    return { received, sent };
}

function getBalanceHistory(data) {
    return Object.values(data)
}

// Use the initialState as a default value
export default function dashboardReducer(state = initialState, action) {
    switch (action.type) {
        case GET_BTC_RATE_FAILURE:
            return {
                ...state,
                btcRates: null,
                loading: false
            };
        case GET_BTC_RATE_SUCCESS:
            initialState.currencies.USD.rate = action.payload.response.USD.last / 100000000
            return {
                ...state,
                loading: false,
                btcRates: action.payload.response,
                currencies: initialState.currencies

            };
        case GET_BTC_RATE:
            return {...state, loading: true };

        case GET_HTLC_EVENT_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case GET_HTLC_EVENT_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                sent: getSentAndReceivedTrx(action.payload.response.data).sent,
                received: getSentAndReceivedTrx(action.payload.response.data).received,
                htlc: action.payload.response.data,
            };
        case GET_HTLC_EVENT:
            return {...state, loading: true };
        case GET_BALANCE_HISTORY_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case GET_BALANCE_HISTORY_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                balanceHistory: getBalanceHistory(action.payload.response.data),
            };
        case GET_BALANCE_HISTORY:
            return {...state, loading: true };
        case GET_TOTAL_BALANCE_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case GET_TOTAL_BALANCE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                balance: action.payload.response.data,
            };
        case GET_TOTAL_BALANCE:
            return {...state, loading: true };
        case GET_NODE_BALANCE:
            return {...state, loading: true };
        case GET_NODE_BALANCE_FAILURE:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case GET_NODE_BALANCE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                selectedNodeBalance: action.payload.response,
            };
        case GET_NODE_CHANNELS:
            return {...state, loading: true };
        case GET_NODE_CHANNELS_FAILURE:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case GET_NODE_CHANNELS_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                selectedNodeChannels: action.payload.response.data,
                totalChannels: action.payload.response.total
            };
        case CHANGE_CURRENCY:
            return {...state, currency: action.payload.currency };
        case SELECT_NODE:
            return {...state, selectedNode: action.payload.node };
        case CHANGE_BALANCE:
            return {
                ...state,
                balance: action.payload.balance,
                received: action.payload.received,
                sent: action.payload.sent,
                balanceHistory: action.payload.balanceHistory,
            };
        case USER_LOGOUT:
            return initialState;
        default:
            return state;
    }
}