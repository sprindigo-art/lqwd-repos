/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import { VERIFY_PAGE_GET_EMAIL, VERIFY_PAGE_SEND } from "./VerifyPageConstants";
import { requestSendVerifyEmail, requestVerifyEmail } from "../../requests/Verify";
import {
  verifyGetEmailFail,
  verifyGetEmailSuccess,
  verifySendEmailFail,
  verifySendEmailSuccess
} from "./VerifyPageActions";

export function* getVerifyEmail() {

  try {
    const response = yield call(requestVerifyEmail);
    if (response.status == 200){
      yield put(verifyGetEmailSuccess(response));
    }else {
      yield put(verifyGetEmailFail(response));
    }
  }catch (err){
    yield put(verifyGetEmailFail(err));
  }
}

export function* sendVerifyEmail(action) {
  const { payload } = action;
  try {
    const response = yield call(requestSendVerifyEmail, payload);
    if (response.status == 200) {
      yield put(verifySendEmailSuccess(response));
    }else{
      yield put(verifySendEmailFail(response));
    }
  }catch (err) {
    yield put(verifySendEmailFail(err));
  }
}

export default function* verifySaga() {
  yield takeLatest(VERIFY_PAGE_SEND, sendVerifyEmail);
  yield takeLatest(VERIFY_PAGE_GET_EMAIL, getVerifyEmail);
}

