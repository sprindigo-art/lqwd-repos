/* eslint-disable */
import produce from 'immer';
import { USER_LOGOUT } from "../App/AppConstants";
export const GET_SUBSCRIPTION_INVOICE = 'lqwd/frontend/GET_SUBSCRIPTION_INVOICE';
export const SHOW_SUBSCRIPTION_INVOICE_MODAL = 'lqwd/frontend/SHOW_SUBSCRIPTION_INVOICE_MODAL';
export const HIDE_SUBSCRIPTION_INVOICE_MODAL = 'lqwd/frontend/HIDE_SUBSCRIPTION_INVOICE_MODAL';

export const getSubscriptionInvoice = ({ nodeName }) => ({
    type: GET_SUBSCRIPTION_INVOICE,
    payload: { nodeName },
});

export const showSubscriptionInvoiceModal = ({ nodeName, response }) => ({
    type: SHOW_SUBSCRIPTION_INVOICE_MODAL,
    payload: { nodeName, response },
});

export function hideSubscriptionInvoiceModal() {
    return { type: HIDE_SUBSCRIPTION_INVOICE_MODAL };
}


export const initialState = {
    showModal: false,
    nodeName: '',
    response: null,
    amount: 1000,
    paymentAddress: 1112222333,
    payment: {
        amount: 1000,
        amountUsd: null,
        rateUsd: null,
        startDate: null,
        endDate: null,
    }
};

const subscriptionInvoiceModalReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_SUBSCRIPTION_INVOICE_MODAL:
                draft.showModal = true;
                draft.nodeName = payload.nodeName;
                draft.response = payload.response;
                draft.paymentAddress = (payload.response.data.paymentMedium != null ? payload.response.data.paymentMedium : "");
                draft.payment = (payload.response.data != null ? payload.response.data : state.payment);
                draft.amount = (payload.response.amount != null ? payload.response.amount : state.payment.amount);
                draft.amount = payload.response.data.amount;
                break;
            case HIDE_SUBSCRIPTION_INVOICE_MODAL:
                draft.showModal = false;
                draft.nodeName = '';
                draft.response = null;
                break;
            case USER_LOGOUT:
                return initialState;
            default:
        }
        return draft;
    });

export default subscriptionInvoiceModalReducer;