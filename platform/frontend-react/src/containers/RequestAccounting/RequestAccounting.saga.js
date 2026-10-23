/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import { requestApiKeyHistory, requestApiKeyList } from "../../requests/RequestAccounting";
import {
  getApiHistoryByKeyFail,
  getApiHistoryByKeySuccess,
  getApiKeysFail,
  getApiKeysSuccess
} from "./RequestAccountingActions";
import { REQUEST_ACCOUNTING_GET_API_KEY_HISTORY, REQUEST_ACCOUNTING_GET_API_KEYS } from "./RequestAccountingConstants";

export function* getApiKeyList(){
  try {
    const response = yield call(requestApiKeyList);
    yield put(getApiKeysSuccess(response));
  }catch (err){
    yield put(getApiKeysFail(err));
  }
}

export function* getApiKeyHistory(action){
  try {
    const { payload } = action;

    const response = yield call(requestApiKeyHistory, payload);
    console.log(response);
    yield put(getApiHistoryByKeySuccess(response));

  }catch (err){
    yield put(getApiHistoryByKeyFail(err));
  }
}
export default function* requestAccountingSaga(){
  yield takeLatest(REQUEST_ACCOUNTING_GET_API_KEYS, getApiKeyList);
  yield takeLatest(REQUEST_ACCOUNTING_GET_API_KEY_HISTORY, getApiKeyHistory)
}