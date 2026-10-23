/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  requestCreateInvoice,
  requestGetInvoices,
  requestSendInvoiceToEmail,
} from '../../requests/Payment';
import {
  rqPaymentInvoiceCreateNodeFailed,
  rqPaymentInvoiceCreateNodeSuccess,
  rqPaymentInvoiceGetInvoicesFailed,
  rqPaymentInvoiceGetInvoicesSuccess,
  rqPaymentInvoiceSendEmailFailed,
  rqPaymentInvoiceSendEmailSuccess,
} from './RqPaymentCreateInvoiceActions';
import {
  RQ_PAYMENT_INVOICE_CREATE_INVOICE,
  RQ_PAYMENT_INVOICE_GET_INVOICES,
  RQ_PAYMENT_INVOICE_SEND_EMAIL,
} from './RqPaymentCreateInvoiceConstants';

export function* rqPaymentInvoice(action) {
  const { payload } = action;
  try {
    const response = yield call(requestCreateInvoice, payload);
    yield put(rqPaymentInvoiceCreateNodeSuccess(response));
  } catch (err) {
    yield put(rqPaymentInvoiceCreateNodeFailed(err));
  }
}

export function* rqPaymentSendInvoiceToEmail(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendInvoiceToEmail, payload);
    yield put(rqPaymentInvoiceSendEmailSuccess(response));
  } catch (err) {
    yield put(rqPaymentInvoiceSendEmailFailed(err));
  }
}

export function* rqPaymentSendInvoiceInvoices(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetInvoices, payload);
    yield put(rqPaymentInvoiceGetInvoicesSuccess(response));
  } catch (err) {
    yield put(rqPaymentInvoiceGetInvoicesFailed(err));
  }
}

export default function* rqPaymentCreateInvoiceSaga() {
  yield takeLatest(RQ_PAYMENT_INVOICE_CREATE_INVOICE, rqPaymentInvoice);
  yield takeLatest(RQ_PAYMENT_INVOICE_SEND_EMAIL, rqPaymentSendInvoiceToEmail);
  yield takeLatest(
    RQ_PAYMENT_INVOICE_GET_INVOICES,
    rqPaymentSendInvoiceInvoices
  );
}
