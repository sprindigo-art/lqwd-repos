/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  withdrawSendCoinsFailed,
  withdrawSendCoinsSuccess,
} from './WithdrawActions';
import { requestSendCoins } from '../../requests/Payment';
import { WITHDRAW_SEND_COINS } from './WithdrawConstants';

export function* withdrawSendCoins(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendCoins, payload);
    if (response.status === 200 || response.txid !== undefined) {
      yield put(withdrawSendCoinsSuccess(response));
    } else {
      yield put(withdrawSendCoinsFailed(response));
    }
  } catch (err) {
    yield put(withdrawSendCoinsFailed(err));
  }
}

export default function* withdrawSaga() {
  yield takeLatest(WITHDRAW_SEND_COINS, withdrawSendCoins);
}
