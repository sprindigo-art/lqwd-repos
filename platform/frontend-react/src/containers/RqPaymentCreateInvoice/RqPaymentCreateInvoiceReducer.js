/* eslint-disable */
import {
    RQ_PAYMENT_INVOICE_AMOUNT_CHANGED,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE_FAILED,
    RQ_PAYMENT_INVOICE_CREATE_INVOICE_SUCCESS,
    RQ_PAYMENT_INVOICE_GET_INVOICES,
    RQ_PAYMENT_INVOICE_GET_INVOICES_FAILED,
    RQ_PAYMENT_INVOICE_GET_INVOICES_SUCCESS,
    RQ_PAYMENT_INVOICE_RESET,
    RQ_PAYMENT_INVOICE_SELECT_NODE,
    RQ_PAYMENT_INVOICE_SEND_EMAIL,
    RQ_PAYMENT_INVOICE_SEND_EMAIL_FAILED,
    RQ_PAYMENT_INVOICE_SEND_EMAIL_SUCCESS,
    RQ_PAYMENT_INVOICE_SET_EMAIL,
    RQ_PAYMENT_INVOICE_SHOW_EMAIL_DIALOG,
    RQ_PAYMENT_INVOICE_SHOW_SUCCESS_DIALOG,
} from "./RqPaymentCreateInvoiceConstants";

export const initialState = {
    error: false,
    errorMsg: null,
    loading: false,
    selectedNode: null,
    amount: "",
    recipientEmail:"",
    invoiceResponse: null,
    showEmailDialog: false,
    showSuccessDialog: false,
    emailSending: false,
    invoices: [],
};


// Use the initialState as a default value
export default function rqPaymentInvoiceReducer(state = initialState, action) {
    switch (action.type) {
        case RQ_PAYMENT_INVOICE_SELECT_NODE:
            return {
                ...state,
                selectedNode: action.payload.node,
            };
        case RQ_PAYMENT_INVOICE_AMOUNT_CHANGED:
            return {
                ...state,
                amount: action.payload.amt,
            };
        case RQ_PAYMENT_INVOICE_CREATE_INVOICE:
            return {
                ...state,
                loading: true
            };
        case RQ_PAYMENT_INVOICE_CREATE_INVOICE_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                invoiceResponse: action.payload.response,
            };
        case RQ_PAYMENT_INVOICE_CREATE_INVOICE_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case RQ_PAYMENT_INVOICE_SEND_EMAIL:
            return {
                ...state,
                emailSending: true
            };
        case RQ_PAYMENT_INVOICE_SEND_EMAIL_SUCCESS:
            return {
                ...state,
                emailSending: false,
                showSuccessDialog: true,
                showEmailDialog: false,
            };
        case RQ_PAYMENT_INVOICE_SEND_EMAIL_FAILED:
            return {
                ...state,
                emailSending: false,
                showSuccessDialog: false,
                error: true,
                errorMsg: action.payload.error,
            };
        case RQ_PAYMENT_INVOICE_RESET:
            return {...state, error: false,
                errorMsg: null,
                loading: false,
                selectedNode: null,
                amount: "",
                invoiceResponse: null,
                recipientEmail:"",
                showEmailDialog: false,
                showSuccessDialog: false,
                emailSending: false,
            }
        case RQ_PAYMENT_INVOICE_SET_EMAIL:
        return {
        ...state,
            recipientEmail: action.payload.email,
        }
        case RQ_PAYMENT_INVOICE_SHOW_EMAIL_DIALOG:
            return {
                ...state,
                showEmailDialog: action.payload.show,
            };
        case RQ_PAYMENT_INVOICE_SHOW_SUCCESS_DIALOG:
            return {
                ...state,
                showSuccessDialog: action.payload.show,
            };
        case RQ_PAYMENT_INVOICE_GET_INVOICES:
            return {
                ...state,
            };
        case RQ_PAYMENT_INVOICE_GET_INVOICES_SUCCESS:
            return {
                ...state,
                invoices: action.payload.response.data.data,
            };
        case RQ_PAYMENT_INVOICE_GET_INVOICES_FAILED:
            return {
                ...state,
                error: true,
                errorMsg: action.payload.error,
            };
        default:
            return state;
    }
}
