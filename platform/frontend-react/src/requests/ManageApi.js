/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
  //path relative to current origin
  baseURL = window.location.origin + baseURL;
}

export function requestNodeList() {
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
  return request(`${baseURL}/lndnode/getlist`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    },
  });
}

export function requestSendManageApiCommand(action) {
  const { payload } = action;
  console.log(JSON.parse(payload.lndNode));
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
  return request(`${baseURL}/lnd/v1/${payload.command}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      lndname: JSON.parse(payload.lndNode).lndNodeName
    },
  }, false, false);
}