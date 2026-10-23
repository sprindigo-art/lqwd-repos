/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
    //path relative to current origin
    baseURL = window.location.origin + baseURL;
}


export function requestGenerateNewAPIKeys(payload) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    const { password } = payload;


    return request(`${baseURL}/setting/apikey/generate`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            password,
        }),
    });
}

export function requestGetListOfAPIKeys() {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/apikey/getlist`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "Accept": "application/json",
        },
    });
}

export function requestGetTotalRequestsForKey({ apikey }) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/apikey/history`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            apikey,
            page: 1,
            size: 1,
        }),
    });
}

export function requestDeactivateKey({ apikey, password }) {
    const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

    return request(`${baseURL}/setting/apikey/deactivate`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        body: new URLSearchParams({
            password,
            apikey,
        }),
    });
}