/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
  //path relative to current origin
  baseURL = window.location.origin + baseURL;
}



export function requestApiKeyList() {
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/setting/apikey/getlist`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export function requestApiKeyHistory(payload) {

  console.log(payload);
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/setting/apikey/history`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: new URLSearchParams({
      apikey: payload.apikey,
      page: payload.page,
      size: payload.size
    }),
  }, false, false);
}