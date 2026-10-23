/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';

import {
  CONFIRM_PASS
} from "./ConfirmResetPasswordConstants";

import {
  confirmResetPasswordFail,
  confirmResetPasswordSuccess
} from "./ConfirmResetPasswordActions";
import { requestConfirmPasswordReset } from "../../requests/Verify";

export function* confirmResetPassword(action){
  const { payload } = action;

  try {
    const response = yield call(requestConfirmPasswordReset, payload);
    if (response.status === 200){
      yield put(confirmResetPasswordSuccess(response));
    }else{
      yield put(confirmResetPasswordFail(response));
    }
  }catch (err){
    yield put(confirmResetPasswordFail(err));
  }
}

export default function* confirmResetSaga() {
  yield takeLatest(CONFIRM_PASS, confirmResetPassword);
}