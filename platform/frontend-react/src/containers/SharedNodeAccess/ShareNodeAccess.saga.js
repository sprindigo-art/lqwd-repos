/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  requestDeleteUserNodeAccess, requestGetShareNodeList, requestGetShareUserList,
  requestInviteNodeAccess,
  requestUpdateUserNodeAccess
} from "../../requests/ShareNodeAccess";
import {
  deleteShareUserNodeAccessFail,
  deleteShareUserNodeAccessSuccess,
  getSharedNodeListFail,
  getSharedNodeListSuccess,
  getSharedUserListFail,
  getSharedUserListSuccess,
  inviteShareNodeAccessFail,
  inviteShareNodeAccessSuccess,
  updateShareUserNodeAccessFail,
  updateShareUserNodeAccessSuccess
} from "./ShareNodeAcessActions";
import {
  SHARE_NODE_ADD_USER,
  SHARE_NODE_DEACTIVATE_SHARE,
  SHARE_NODE_GET_NODE_LIST, SHARE_NODE_GET_USER_LIST,
  SHARE_NODE_UPDATE_STATUS
} from "./ShareNodeAccessContants";

export function* shareNodeAccessAddUser(action) {
  const { payload } = action;
  try {
    const response = yield call(requestInviteNodeAccess, payload);
    yield put(inviteShareNodeAccessSuccess(response));
  }catch (err){
    yield put(inviteShareNodeAccessFail(err));
  }
}

export function* updateShareNodeAccess(action) {
  const { payload } = action;
  try {
    const response = yield call(requestUpdateUserNodeAccess, payload);
    yield put(updateShareUserNodeAccessSuccess(response));
  }catch (err){
    yield put(updateShareUserNodeAccessFail(err));
  }
}

export function* deleteShareNodeAccess(action) {
  const { payload } = action;
  try {
    const response = yield call(requestDeleteUserNodeAccess, payload);
    yield put(deleteShareUserNodeAccessSuccess(response));
  }catch (err){
    yield put(deleteShareUserNodeAccessFail(err));
  }
}

export function* shareNodeGetNodeList(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetShareNodeList, payload);
    yield put(getSharedNodeListSuccess(response));
  }catch (err){
    yield put(getSharedNodeListFail(err));
  }
}

export function* shareNodeGetUserList(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetShareUserList, payload);
    yield put(getSharedUserListSuccess(response));
  }catch (err){
    yield put(getSharedUserListFail(err));
  }
}

export default function* shareNodeAccessSaga() {
  yield takeLatest(SHARE_NODE_ADD_USER, shareNodeAccessAddUser);
  yield takeLatest(SHARE_NODE_UPDATE_STATUS, updateShareNodeAccess);
  yield takeLatest(SHARE_NODE_DEACTIVATE_SHARE, deleteShareNodeAccess);
  yield takeLatest(SHARE_NODE_GET_NODE_LIST, shareNodeGetNodeList);
  yield takeLatest(SHARE_NODE_GET_USER_LIST, shareNodeGetUserList);
}