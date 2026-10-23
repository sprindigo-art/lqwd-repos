/* eslint-disable */
import { call, put, select, takeLatest } from 'redux-saga/effects';
import { requestNumberOfRegisteredUsers } from "../../requests/Signup";

import {
  getCurrentNumberRegisteredFail,
  getCurrentNumberRegisteredSuccess, signupPageLoginFail,
  signupPageLoginSuccess
} from "./SignupPageActions";

import { SIGNUP_PAGE_GET_NUM_BETA_SPOTS, SIGNUP_PAGE_MFA_LOGIN } from "./SignupPageConstant";
import request from "../../utils/request";

const baseURL = process.env.REACT_APP_DLA_BASE_URL;

export function* getNumberOfRegisteredUsers() {
  try {
    const response = yield call(requestNumberOfRegisteredUsers);
    yield put(getCurrentNumberRegisteredSuccess(response));
  } catch (err) {
    yield put(getCurrentNumberRegisteredFail(err));
  }
}

export function* signupPageLoginMfa(action) {
  const { payload } = action;

  const requestURL = `${baseURL}/login/token`;
  console.log(payload);
  const requestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      username: payload.username,
      password: payload.password,
      mfaCode: payload.mfaCode,
    }),
  };

  try {
    const response = yield call(request, requestURL, requestOptions);
    console.log(response);
    if (response.status === 200) {
      yield put(signupPageLoginSuccess(response));
    }else if (response.status === 403) {
      yield put(signupPageLoginSuccess(response));
    } else {
      yield put(signupPageLoginFail(response));
    }
  } catch (err) {
    yield put(signupPageLoginFail(err));
  }
}

export default function* signupPageSaga() {
  yield takeLatest(SIGNUP_PAGE_GET_NUM_BETA_SPOTS, getNumberOfRegisteredUsers);
  yield takeLatest(SIGNUP_PAGE_MFA_LOGIN, signupPageLoginMfa);
}