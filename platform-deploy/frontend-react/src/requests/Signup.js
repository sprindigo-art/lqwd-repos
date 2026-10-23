/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}

export function requestNumberOfRegisteredUsers(payload) {
    return request(`${baseURL}/login/number_of_registered_users`, {
        method: 'GET'
    });
}

export function requestSignup(payload) {

    const requestURL = `${baseURL}/login/registration`;

    return request(requestURL, {
        method: 'POST',
        headers: {
            // 'Content-Type': 'application/json'
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            username: payload.username.toLowerCase(),
            email: payload.username.toLowerCase(),
            password: payload.password
        }),
        json: true
    }, true, false);

}

export function requestSubscribeWaitlist(payload) {

    const requestURL = `${baseURL}/login/v1/subscribe?email=${payload.email}`;

    return request(requestURL, {
        method: 'POST',
        headers: {
            // 'Content-Type': 'application/json'
            'Content-Type': 'application/json',
        }
    }, false, false);
}