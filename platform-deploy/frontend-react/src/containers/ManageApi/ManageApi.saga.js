/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import { MANAGE_API_GET_NODES, MANAGE_API_SEND_COMMAND } from "./ManageApiConstants";
import {
  getManageApiNodesFailed,
  getManageApiNodesSuccess,
  sendManageApiCommandFailed,
  sendManageApiCommandSuccess
} from "./ManageApiActions";
import { requestNodeList, requestSendManageApiCommand } from "../../requests/ManageApi";

export function* getNodeListManageApi() {
  try {
    const response = yield call(requestNodeList);
    if (response.status == 200) {
      yield put(getManageApiNodesSuccess(response));
    }else {
      yield put(getManageApiNodesFailed(response));
    }
  } catch (err) {
    yield put(getManageApiNodesFailed(err));
  }
}

export function* getManageApiCommand(action){
  try {
    const response = yield call(requestSendManageApiCommand, action);
    yield put(sendManageApiCommandSuccess(response));
  } catch (err) {
    yield put(sendManageApiCommandFailed(err));
  }
}

export default function* manageApiSaga() {
  yield takeLatest(MANAGE_API_GET_NODES, getNodeListManageApi);
  yield takeLatest(MANAGE_API_SEND_COMMAND, getManageApiCommand);
}