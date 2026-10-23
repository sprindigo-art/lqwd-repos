/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestVerifyEmail() {

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/userinfo`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestSendVerifyEmail(payload) {

    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/login/verification/send`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
        },
        body: new URLSearchParams({
            email: payload.email,
        }),
    });
}

export function requestConfirmVerifyEmail(payload) {

    const { token } = payload;

    return request(`${baseURL}/login/confirm-account?token=${token}`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });
}

export function requestConfirmPasswordReset(payload) {

    return request(`${baseURL}/login/recovery/password`, {
        method: 'POST',
        body: new URLSearchParams({
            password: payload.password,
            token: payload.token,
        }),
    }, true, false);
}