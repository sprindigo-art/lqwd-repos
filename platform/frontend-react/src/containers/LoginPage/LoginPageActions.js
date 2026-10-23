/* eslint-disable */
import {
    LOGIN_SUCCEEDED,
    TRY_LOGOUT,
    LOGGED_IN,
    TRY_LOGIN_MFA,
    LOGIN_MFA_FAILED,
} from './LoginPageConstants';

export function tryLoginMfa(username, password, mfaCode) {
    return { type: TRY_LOGIN_MFA, payload: { username, password, mfaCode } };
}

export function loginSuccess(user) {
    return { type: LOGIN_SUCCEEDED, payload: { user } };
}

export function loginMfaError(error) {
    return { type: LOGIN_MFA_FAILED, payload: { error } };
}

export function loggedIn() {
    return { type: LOGGED_IN };
}

export function tryLogout(error) {
    return { type: TRY_LOGOUT };
}