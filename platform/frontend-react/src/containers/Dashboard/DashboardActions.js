import {
  GET_HTLC_EVENT,
  GET_HTLC_EVENT_FAILED,
  GET_HTLC_EVENT_SUCCESS,
  CHANGE_CURRENCY,
  CHANGE_BALANCE,
  GET_NODE_BALANCE,
  GET_NODE_BALANCE_SUCCESS,
  GET_NODE_BALANCE_FAILURE,
  GET_NODE_CHANNELS,
  GET_NODE_CHANNELS_SUCCESS,
  GET_NODE_CHANNELS_FAILURE,
  GET_BALANCE_HISTORY,
  GET_BALANCE_HISTORY_SUCCESS,
  GET_BALANCE_HISTORY_FAILED,
  GET_TOTAL_BALANCE,
  GET_TOTAL_BALANCE_SUCCESS,
  GET_TOTAL_BALANCE_FAILED,
  GET_BTC_RATE,
  GET_BTC_RATE_FAILURE,
  GET_BTC_RATE_SUCCESS,
} from './DashboardConstants';

export function getHTLCEvent(startDate, endDate) {
  return { type: GET_HTLC_EVENT, payload: { startDate, endDate } };
}

export function getHTLCEventSuccess(response) {
  return { type: GET_HTLC_EVENT_SUCCESS, payload: { response } };
}

export function getHTLCEventFailed(error) {
  return { type: GET_HTLC_EVENT_FAILED, payload: { error } };
}

export function getNodeBalanceHistoryEvent(startDate, endDate) {
  return { type: GET_BALANCE_HISTORY, payload: { startDate, endDate } };
}

export function getNodeBalanceHistorySuccess(response) {
  return { type: GET_BALANCE_HISTORY_SUCCESS, payload: { response } };
}

export function getNodeBalanceHistoryFailed(error) {
  return { type: GET_BALANCE_HISTORY_FAILED, payload: { error } };
}

export function getTotalNodeBalance() {
  return { type: GET_TOTAL_BALANCE };
}

export function getTotalNodeBalanceSuccess(response) {
  return { type: GET_TOTAL_BALANCE_SUCCESS, payload: { response } };
}

export function getTotalNodeBalanceFailed(error) {
  return { type: GET_TOTAL_BALANCE_FAILED, payload: { error } };
}

export function changeCurrency(selectedCurrency) {
  return { type: CHANGE_CURRENCY, payload: { currency: selectedCurrency } };
}

export function getBTCRate() {
  return {
    type: GET_BTC_RATE,
  };
}

export function getBTCRateFailed(err) {
  return {
    type: GET_BTC_RATE_FAILURE,
    payload: { err },
  };
}

export function getBTCRateSuccess(response) {
  return {
    type: GET_BTC_RATE_SUCCESS,
    payload: { response },
  };
}

export function getNodeBalance(nodeName) {
  return { type: GET_NODE_BALANCE, payload: { nodeName } };
}

export function nodeBalanceSuccess(response) {
  return { type: GET_NODE_BALANCE_SUCCESS, payload: { response } };
}

export function nodeBalanceFailure(error) {
  return { type: GET_NODE_BALANCE_FAILURE, payload: { error } };
}

export function getNodeChannels(nodeName) {
  return { type: GET_NODE_CHANNELS, payload: { nodeName } };
}

export function nodeChannelsSuccess(response) {
  return { type: GET_NODE_CHANNELS_SUCCESS, payload: { response } };
}

export function nodeChannelsFailure(error) {
  return { type: GET_NODE_CHANNELS_FAILURE, payload: { error } };
}
