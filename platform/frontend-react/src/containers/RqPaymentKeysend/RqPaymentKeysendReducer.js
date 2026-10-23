/* eslint-disable */
import {
    RQ_PAYMENT_INVOICE_AMOUNT_CHANGED,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE_FAILED,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE_SUCCESS,
    RQ_PAYMENT_INVOICE_RESET,
    RQ_PAYMENT_INVOICE_SELECT_NODE,
    RQ_PAYMENT_INVOICE_SEND_EMAIL,
    RQ_PAYMENT_INVOICE_SEND_EMAIL_FAILED,
    RQ_PAYMENT_INVOICE_SEND_EMAIL_SUCCESS,
    RQ_PAYMENT_INVOICE_SET_EMAIL,
    RQ_PAYMENT_INVOICE_SHOW_EMAIL_DIALOG,
    RQ_PAYMENT_KEY_GET_INVOICES,
    RQ_PAYMENT_KEY_GET_INVOICES_FAILED,
    RQ_PAYMENT_KEY_GET_INVOICES_SUCCESS,
    RQ_PAYMENT_KEY_RESET,
    RQ_PAYMENT_KEY_SELECT_NODE,
    RQ_PAYMENT_KEY_SEND_EMAIL,
    RQ_PAYMENT_KEY_SEND_EMAIL_FAILED,
    RQ_PAYMENT_KEY_SEND_EMAIL_SUCCESS,
    RQ_PAYMENT_KEY_SET_EMAIL,
    RQ_PAYMENT_KEY_SET_NODE_ADDRESS,
    RQ_PAYMENT_KEY_SHOW_EMAIL_DIALOG,
    RQ_PAYMENT_KEY_SHOW_SUCCESS_DIALOG,
} from "./RqPaymentKeysendConstants";
import {
    RQ_PAYMENT_INVOICE_GET_INVOICES, RQ_PAYMENT_INVOICE_GET_INVOICES_FAILED,
    RQ_PAYMENT_INVOICE_GET_INVOICES_SUCCESS
} from "../RqPaymentCreateInvoice/RqPaymentCreateInvoiceConstants";

export const initialState = {
    error: false,
    errorMsg: null,
    loading: false,
    selectedNode: null,
    recipientEmail:"",
    showEmailDialog: false,
    showSuccessDialog: false,
    emailSending: false,
    nodeAddress: "",
    invoices: []
};


// Use the initialState as a default value
export default function rqPaymentKeySendReducer(state = initialState, action) {
    switch (action.type) {
        case RQ_PAYMENT_KEY_SEND_EMAIL:
            return {
                ...state,
                emailSending: true
            };
        case RQ_PAYMENT_KEY_SEND_EMAIL_SUCCESS:
            return {
                ...state,
                emailSending: false,
                showSuccessDialog: true,
                showEmailDialog: false,
            };
        case RQ_PAYMENT_KEY_SEND_EMAIL_FAILED:
            return {
                ...state,
                emailSending: false,
                showSuccessDialog: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case RQ_PAYMENT_KEY_RESET:
            return {...state, error: false,
                errorMsg: null,
                loading: false,
                recipientEmail:"",
                showEmailDialog: false,
                showSuccessDialog: false,
                emailSending: false,
                nodeAddress: "",
            }
        case RQ_PAYMENT_KEY_SET_EMAIL:
        return {
        ...state,
            recipientEmail: action.payload.email,
        }
        case RQ_PAYMENT_KEY_SET_NODE_ADDRESS:
            return {
                ...state,
                nodeAddress: action.payload.nodeAddress,
            }
        case RQ_PAYMENT_KEY_SHOW_EMAIL_DIALOG:
            return {
                ...state,
                showEmailDialog: action.payload.show,
            };
        case RQ_PAYMENT_KEY_SHOW_SUCCESS_DIALOG:
            return {
                ...state,
                showSuccessDialog: action.payload.show,
            };

        case RQ_PAYMENT_KEY_SELECT_NODE:
            return {
                ...state,
                selectedNode: action.payload.node,
            };
        case RQ_PAYMENT_KEY_GET_INVOICES:
            return {
                ...state,
            };
        case RQ_PAYMENT_KEY_GET_INVOICES_SUCCESS:
            return {
                ...state,
                invoices: action.payload.response.data.data,
            };
        case RQ_PAYMENT_KEY_GET_INVOICES_FAILED:
            return {
                ...state,
                error: true,
                errorMsg: action.payload.error,
            };
        default:
            return state;
    }
}
