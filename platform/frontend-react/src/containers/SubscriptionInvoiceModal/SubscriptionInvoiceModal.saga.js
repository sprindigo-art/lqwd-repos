/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
    GET_SUBSCRIPTION_INVOICE,
} from './SubscriptionInvoiceModalReducer';

import {
    showSubscriptionInvoiceModal,
    hideSubscriptionInvoiceModal
} from './SubscriptionInvoiceModalReducer';

import { enqueueSnackbar, closeSnackbar } from "../Notifier/NotifierActions";
import { requestGetSubscriptionInvoide } from '../../requests/Subscription';

export function* getInvoice(action) {
    const { payload } = action;

    try {
        const response = yield call(requestGetSubscriptionInvoide, payload);
        yield put(showSubscriptionInvoiceModal({ response, ...payload }));
    } catch (err) {
        yield put(
            enqueueSnackbar({
                message: `Getting invoice failed ${JSON.stringify(err)}`,
                options: {
                    variant: "error",
                    autoHideDuration: 10000,
                }
            })
        );
        yield put(hideSubscriptionInvoiceModal());
    }

}


export default function* subscriptionInvoideSaga() {
    yield takeLatest(GET_SUBSCRIPTION_INVOICE, getInvoice);
}