/* eslint-disable */

import {
    SEND_PAYMENT_CHANNEL_DATA_CHANGED,
    SEND_PAYMENT_DECODE_INVOICE,
    SEND_PAYMENT_DECODE_INVOICE_FAILED,
    SEND_PAYMENT_DECODE_INVOICE_SUCCESS,
    SEND_PAYMENT_GET_AVAILABLE_CHANNEL,
    SEND_PAYMENT_GET_AVAILABLE_CHANNEL_FAILED,
    SEND_PAYMENT_GET_AVAILABLE_CHANNEL_SUCCESS,
    SEND_PAYMENT_OPEN_CHANNEL,
    SEND_PAYMENT_OPEN_CHANNEL_FAILED,
    SEND_PAYMENT_OPEN_CHANNEL_SUCCESS,
    SEND_PAYMENT_PAY,
    SEND_PAYMENT_PAY_FAILED,
    SEND_PAYMENT_PAY_SUCCESS,
    SEND_PAYMENT_QUERY_ROUTE,
    SEND_PAYMENT_QUERY_ROUTE_FAILED,
    SEND_PAYMENT_QUERY_ROUTE_SUCCESS,
    SEND_PAYMENT_RESET,
    SEND_PAYMENT_SELECT_NODE,
    SEND_PAYMENT_SET_ACTIVE_STEP,
    SEND_PAYMENT_SHOW_STEP, SEND_PAYMENT_TOGGLE_AUTH,
    SEND_PAYMENT_UPDATE_INVOICE

} from "./PayInvoiceConstants";

export const initialState = {
    activeStep: 0,
    error: false,
    errorMsg: null,
    loading: false,
    nodes: [],
    selectedNode: null,
    invoice: "",
    showStep: false,
    decodedInvoice: null,
    channelData: {
        amount: '',
        satPerVByte: '',
        private: "false",
        remoteAddr: ''
    },
    route: null,
    paymentResponse: null,
    password: null,
    passphrase: null,
    showAuth: false
};


// Use the initialState as a default value
export default function payInvoiceReducer(state = initialState, action) {
    switch (action.type) {
        case SEND_PAYMENT_SELECT_NODE:
            return {...state, selectedNode: action.payload.node };
        case SEND_PAYMENT_UPDATE_INVOICE:
            return {...state, invoice: action.payload.paymentRequest };
        case SEND_PAYMENT_DECODE_INVOICE_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
                activeStep: 1
            };
        case SEND_PAYMENT_DECODE_INVOICE_SUCCESS:
            console.log(state.activeStep);
            return {
                ...state,
                loading: false,
                error: false,
                decodedInvoice: action.payload.response,
                activeStep: 0,
                showStep: true
            };
        case SEND_PAYMENT_DECODE_INVOICE:
            return {...state, loading: true };

        // case SEND_PAYMENT_OPEN_CHANNEL_FAILED:
        //     return {
        //         ...state,
        //         loading: false,
        //         error: true,
        //         errorMsg: action.payload.error.message,
        //         activeStep: state.activeStep + 1
        //     };
        //
        // case SEND_PAYMENT_OPEN_CHANNEL_SUCCESS:
        //     return {
        //         ...state,
        //         loading: false,
        //         error: false,
        //         channel: action.payload.response.data,
        //         activeStep: state.activeStep + 1
        //     };
        // case SEND_PAYMENT_OPEN_CHANNEL:
        //     return {...state, loading: true };
        case SEND_PAYMENT_CHANNEL_DATA_CHANGED:
            return {...state, channelData: action.payload.data }

        case SEND_PAYMENT_QUERY_ROUTE_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
                activeStep: state.activeStep + 1
            };
        case SEND_PAYMENT_QUERY_ROUTE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                route: action.payload.response,
                activeStep: state.activeStep + 2
            };
        case SEND_PAYMENT_QUERY_ROUTE:
            return {...state, loading: true };
        case SEND_PAYMENT_SET_ACTIVE_STEP:
            return {...state, activeStep: action.payload.index };
        case SEND_PAYMENT_PAY_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error.result.failure_reason,
                activeStep: state.activeStep + 1
            };

        case SEND_PAYMENT_PAY_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                paymentResponse: action.payload.response,
                activeStep: state.activeStep + 1
            };
        case SEND_PAYMENT_PAY:
            return {...state, loading: true };
        case SEND_PAYMENT_SHOW_STEP:
            return {...state, showStep: action.payload.show};
        case SEND_PAYMENT_RESET:
            return {...state, error: false,
                errorMsg: null,
                loading: false,
                invoice: "",
                decodedInvoice: null,
                channelData: {
                    amount: '',
                    satPerVByte: '',
                    private: "false",
                    remoteAddr: ''
                },
                channel: null,
                paymentResponse: null
            };
        case SEND_PAYMENT_TOGGLE_AUTH:
            return {
                ...state,
                showAuth: !state.showAuth
            }
        default:
            return state;
    }
}