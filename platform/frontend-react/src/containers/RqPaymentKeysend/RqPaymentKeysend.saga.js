/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  requestGetInvoices,
  requestSendKeySendToEmail,
} from '../../requests/Payment';
import {
  rqPaymentKeyeGetInvoicesSuccess,
  rqPaymentKeyInvoicesFailed,
  rqPaymentKeySendEmailFailed,
  rqPaymentKeySendEmailSuccess,
} from './RqPaymentKeysendActions';
import {
  RQ_PAYMENT_KEY_GET_INVOICES,
  RQ_PAYMENT_KEY_SEND_EMAIL,
} from './RqPaymentKeysendConstants';
import {
  rqPaymentInvoiceGetInvoicesFailed,
  rqPaymentInvoiceGetInvoicesSuccess,
} from '../RqPaymentCreateInvoice/RqPaymentCreateInvoiceActions';

export function* rqPaymentSendKeySendToEmail(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendKeySendToEmail, payload);
    yield put(rqPaymentKeySendEmailSuccess(response));
  } catch (err) {
    yield put(rqPaymentKeySendEmailFailed(err));
  }
}

export function* rqPaymentSendKeyInvoices(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetInvoices, payload);
    yield put(rqPaymentKeyeGetInvoicesSuccess(response));
  } catch (err) {
    yield put(rqPaymentKeyInvoicesFailed(err));
  }
}

export default function* rqPaymentKeysendSaga() {
  yield takeLatest(RQ_PAYMENT_KEY_SEND_EMAIL, rqPaymentSendKeySendToEmail);
  yield takeLatest(RQ_PAYMENT_KEY_GET_INVOICES, rqPaymentSendKeyInvoices);
}
