/* eslint-disable */
import request, { isValidUrl } from "../utils/request";

let baseURL = process.env.REACT_APP_DLA_BASE_URL;
if (!isValidUrl(baseURL)) {
  //path relative to current origin
  baseURL = window.location.origin + baseURL;
}

export function requestInviteNodeAccess(payload) {
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  console.log(payload);
  return request(`${baseURL}/share/lnd`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sharedEmail: payload.email,
      lndNodeName: payload.lndName,
      role: payload.role,
      passphrase: payload.passphrase,
      password: payload.password,
      newPassphrase: payload.newPassphrase
    }),
    json:true
  }, false, false);
}

export function requestUpdateUserNodeAccess(payload){
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  console.log(payload);
  return request(`${baseURL}/share/lnd/update`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sharedEmail: payload.email,
      lndNodeName: payload.lndName,
      role: payload.role,
      password: payload.password
    })
  }, false, false);
}

export function requestDeleteUserNodeAccess(payload){
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/share/lnd/delete`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sharedEmail: payload.email,
      lndNodeName: payload.lndName,
      role: payload.role,
      password: payload.password
    })
  }, false, false);
}

export function requestGetShareUserList(payload){
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/share/getsharedusers`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });
}

export function requestGetShareNodeList(){
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/share/getlist`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });
}

export function requestGetShareUserListHistory(payload){
  const token = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;

  return request(`${baseURL}/share/getsharedusers/history`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    }
  });
}