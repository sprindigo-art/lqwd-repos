/* eslint-disable */
import request, { isValidUrl } from "../utils/request";
import { loginError, loginMfaSuccess, loginSuccess } from "../containers/LoginPage/LoginPageActions";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestGetLatestAppVersion() {
    return request(`/version`, { method: 'GET' });
}

export function requestLogin(payload) {
    // Select username from store
    //  const username = yield select(makeSelectUsername());
    //  const requestURL = `https://api.github.com/users/${username}/repos?type=all&sort=updated`;
    const requestURL = `${baseURL}/login/authorize/check_credentials`;

    return request(requestURL, {
        method: 'POST',
        headers: {
            // 'Content-Type': 'application/json'
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            username: payload.username,
            password: payload.password,
        }),
    }, false, false);

}

export function requestLoginMfa(payload) {

    const requestURL = `${baseURL}/login/token`;

    return request(requestURL, {
        method: 'POST',
        headers: {
            // 'Content-Type': 'application/json'
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            username: payload.username,
            password: payload.password,
            mfaCode: payload.mfaCode
        }),
    }, false, false);

}

export function requestResetPassword(payload) {
    const requestURL = `${baseURL}/login/recovery/send`;

    return request(requestURL, {
        method: 'POST',
        headers: {
            // 'Content-Type': 'application/json'
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            identity: payload.email,
        }),
    });

}

export function getUserInfo() {

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/userinfo`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function updateUserInfo(payload) {

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/userinfo/update`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            firstname: payload.firstName,
            lastname: payload.lastName,
            phone: payload.phone,
        }),

    });
}

export function changePassword(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/login/password/update`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            oldPassword: payload.oldPassword,
            newPassword: payload.newPassword,
        }),

    });
}