/* eslint-disable */
import { call, put, select, takeLatest } from 'redux-saga/effects';
import request from 'utils/request';
import { loginSuccess, loginMfaSuccess, loginMfaError } from "./LoginPageActions";

import {
    TRY_LOGIN_MFA,
} from './LoginPageConstants';
import { requestLoginMfa } from "../../requests/Login";

const baseURL = process.env.REACT_APP_DLA_BASE_URL;


export function* doLoginMfa(action) {
    const { payload } = action;

    try {
        const response = yield call(requestLoginMfa, payload);
        console.log(response);
        if (response.status === 200) {
            yield put(loginSuccess(response));
        } else {
            yield put(loginMfaError(response));
        }
    } catch (err) {
        yield put(loginMfaError(err));
    }
}

export default function* lqwdLogin() {
    yield takeLatest(TRY_LOGIN_MFA, doLoginMfa);
}