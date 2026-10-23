/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  sendPaymentDecodeInvoiceFailed,
  sendPaymentDecodeInvoiceSuccess,
  sendPaymentOpenChannelFailed,
  sendPaymentOpenChannelSuccess,
  sendPaymentPayFailed,
  sendPaymentPaySuccess,
  sendPaymentQueryRouteFailed,
  sendPaymentQueryRouteSuccess,
} from './PayInvoiceActions';
import {
  SEND_PAYMENT_DECODE_INVOICE,
  SEND_PAYMENT_DECODE_INVOICE_SUCCESS,
  SEND_PAYMENT_OPEN_CHANNEL,
  SEND_PAYMENT_OPEN_CHANNEL_SUCCESS,
  SEND_PAYMENT_PAY,
  SEND_PAYMENT_QUERY_ROUTE,
  SEND_PAYMENT_QUERY_ROUTE_SUCCESS,
} from './PayInvoiceConstants';
import {
  requestFindAvailableChannel,
  requestGetOpenChannel,
  requestGetPaymentRequest,
  requestQueryRoute,
  requestSendPayment,
} from '../../requests/Payment';

export function* sendPaymentDecodeInvoice(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetPaymentRequest, payload);
    yield put(sendPaymentDecodeInvoiceSuccess(response, payload.nodeName));
  } catch (err) {
    yield put(sendPaymentDecodeInvoiceFailed(err));
  }
}

export function* sendPaymentOpenChannel(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetOpenChannel, payload);
    yield put(
      sendPaymentOpenChannelSuccess(
        response,
        payload.paymentRequest,
        payload.nodeName
      )
    );
  } catch (err) {
    const reader = err.response.body.getReader();
    const { value, done } = yield reader.read();
    if (done) {
      yield put(sendPaymentOpenChannelFailed(err));
    } else {
      const v = JSON.parse(String.fromCharCode(...value));
      yield put(sendPaymentOpenChannelFailed(v));
    }
  }
}

export function* sendPaymentPay(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendPayment, payload);
    const result = response.split(/\r?\n/);

    let res = { result: { status: 'SUCCESS' } };

    if (result.length > 0) {
      res = JSON.parse(result[result.length === 1 ? 0 : result.length - 2]);
    }

    if (res.result.status === 'FAILED') {
      yield put(sendPaymentPayFailed(res));
    } else {
      yield put(sendPaymentPaySuccess(res));
    }
  } catch (err) {
    yield put(
      sendPaymentPayFailed({
        result: { failure_reason: 'something went wrong' },
      })
    );
  }
}

export function* sendPaymentQueryRoute(action) {
  const { payload } = action;
  try {
    const response = yield call(requestQueryRoute, payload);
    yield put(sendPaymentQueryRouteSuccess(response));
  } catch (err) {
    yield put(sendPaymentQueryRouteFailed(err));
  }
}

export default function* paymentSaga() {
  yield takeLatest(SEND_PAYMENT_DECODE_INVOICE, sendPaymentDecodeInvoice);
  yield takeLatest(SEND_PAYMENT_OPEN_CHANNEL, sendPaymentOpenChannel);
  yield takeLatest(SEND_PAYMENT_QUERY_ROUTE, sendPaymentQueryRoute);
  // yield takeLatest(SEND_PAYMENT_OPEN_CHANNEL_SUCCESS, sendPaymentPay);
  yield takeLatest(SEND_PAYMENT_PAY, sendPaymentPay);
}
