/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import { requestSendCoins } from '../../requests/Payment';
import {
  sendPaymentKeySendPayFailed,
  sendPaymentKeySendPaySuccess,
} from './PayKeySendActions';
import { SEND_PAYMENT_KEY_SEND_PAY } from './PayKeySendConstants';

export function* sendPaymentPayKeySend(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendCoins, payload);

    if (response.payment_error != null) {
      yield put(sendPaymentKeySendPayFailed(response.payment_error));
    } else {
      yield put(sendPaymentKeySendPaySuccess(response));
    }
  } catch (err) {
    yield put(
      sendPaymentKeySendPayFailed({
        result: { failure_reason: 'something went wrong' },
      })
    );
  }
}

export default function* payKeySendSaga() {
  yield takeLatest(SEND_PAYMENT_KEY_SEND_PAY, sendPaymentPayKeySend);
}
