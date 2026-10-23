/* eslint-disable no-console */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  getBTCRateFailed,
  getBTCRateSuccess,
  getHTLCEventFailed,
  getHTLCEventSuccess,
  getNodeBalanceHistoryFailed,
  getNodeBalanceHistorySuccess,
  getTotalNodeBalanceFailed,
  getTotalNodeBalanceSuccess,
  nodeBalanceFailure,
  nodeBalanceSuccess,
  nodeChannelsFailure,
  nodeChannelsSuccess,
} from './DashboardActions';
import {
  GET_BALANCE_HISTORY,
  GET_BTC_RATE,
  GET_HTLC_EVENT,
  GET_NODE_BALANCE,
  GET_NODE_CHANNELS,
  GET_TOTAL_BALANCE,
} from './DashboardConstants';
import {
  requestGetHTLCEvents,
  requestGetNodeBalance,
  requestGetNodeChannels,
  requestNodeBalanceHistory,
  requestTotalNodeBalance,
  requestGetBTCRates,
} from '../../requests/Dashboard';

export function* getHTLCEventsFromAPI(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetHTLCEvents, payload);
    yield put(getHTLCEventSuccess(response));
  } catch (err) {
    yield put(getHTLCEventFailed(err));
  }
}

export function* getNodeBalanceHistoryAPI(action) {
  const { payload } = action;
  try {
    const response = yield call(requestNodeBalanceHistory, payload);
    yield put(getNodeBalanceHistorySuccess(response));
  } catch (err) {
    yield put(getNodeBalanceHistoryFailed(err));
  }
}

export function* getTotalNodeBalanceAPI() {
  try {
    const response = yield call(requestTotalNodeBalance);
    yield put(getTotalNodeBalanceSuccess(response));
  } catch (err) {
    yield put(getTotalNodeBalanceFailed(err));
  }
}

export function* getBTCRatesAPI() {
  try {
    const response = yield call(requestGetBTCRates);
    yield put(getBTCRateSuccess(response));
  } catch (err) {
    yield put(getBTCRateFailed(err));
  }
}

export function* getNodeBalanceAPI(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetNodeBalance, payload);
    yield put(nodeBalanceSuccess(response));
  } catch (err) {
    yield put(nodeBalanceFailure(err));
  }
}

export function* getNodeChannelsAPI(action) {
  const { payload } = action;

  try {
    const response = yield call(requestGetNodeChannels, payload);
    yield put(nodeChannelsSuccess(response));
  } catch (err) {
    yield put(nodeChannelsFailure(err));
  }
}

export default function* dashboardSaga() {
  yield takeLatest(GET_HTLC_EVENT, getHTLCEventsFromAPI);
  yield takeLatest(GET_NODE_BALANCE, getNodeBalanceAPI);
  yield takeLatest(GET_NODE_CHANNELS, getNodeChannelsAPI);
  yield takeLatest(GET_BALANCE_HISTORY, getNodeBalanceHistoryAPI);
  yield takeLatest(GET_TOTAL_BALANCE, getTotalNodeBalanceAPI);
  yield takeLatest(GET_BTC_RATE, getBTCRatesAPI);
}
