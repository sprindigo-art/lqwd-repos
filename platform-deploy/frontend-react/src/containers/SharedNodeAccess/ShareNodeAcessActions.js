/* eslint-disable */

import {
  SHARE_NODE_ADD_USER,
  SHARE_NODE_ADD_USER_FAIL,
  SHARE_NODE_ADD_USER_SUCCESS,
  SHARE_NODE_DEACTIVATE_SHARE,
  SHARE_NODE_DEACTIVATE_SHARE_FAIL,
  SHARE_NODE_DEACTIVATE_SHARE_SUCCESS,
  SHARE_NODE_GET_NODE_LIST,
  SHARE_NODE_GET_NODE_LIST_FAIL,
  SHARE_NODE_GET_NODE_LIST_SUCCESS,
  SHARE_NODE_GET_USER_LIST,
  SHARE_NODE_GET_USER_LIST_FAIL,
  SHARE_NODE_GET_USER_LIST_SUCCESS,
  SHARE_NODE_RESET_USER_INFO,
  SHARE_NODE_SET_USER_INFO,
  SHARE_NODE_UPDATE_STATUS,
  SHARE_NODE_UPDATE_STATUS_FAIL,
  SHARE_NODE_UPDATE_STATUS_SUCCESS
} from "./ShareNodeAccessContants";

export function setUserData(email, role, lndName, newPassphrase) {
  return {
    type: SHARE_NODE_SET_USER_INFO,
    payload: { email, role, lndName, newPassphrase }
  };
}

export function resetUserData() {
  return {
    type: SHARE_NODE_RESET_USER_INFO
  };
}


export function inviteShareNodeAccess(email, role, lndName, passphrase, newPassphrase, password) {
  return {
    type: SHARE_NODE_ADD_USER,
    payload: { email, role, lndName, passphrase, newPassphrase, password }
  };
}

export function inviteShareNodeAccessSuccess(response) {
  return {
    type: SHARE_NODE_ADD_USER_SUCCESS,
    payload: { response }
  };
}

export function inviteShareNodeAccessFail(error) {
  return {
    type: SHARE_NODE_ADD_USER_FAIL,
    payload: { error }
  };
}

export function updateShareUserNodeAccess(email, role, lndName, password) {
  return {
    type: SHARE_NODE_UPDATE_STATUS,
    payload: { email, role, lndName, password }
  };
}

export function updateShareUserNodeAccessSuccess(response) {
  return {
    type: SHARE_NODE_UPDATE_STATUS_SUCCESS,
    payload: { response }
  };
}

export function updateShareUserNodeAccessFail(error) {
  return {
    type: SHARE_NODE_UPDATE_STATUS_FAIL,
    payload: { error }
  };
}

export function deleteShareUserNodeAccess(email, role, lndName, password) {
  return {
    type: SHARE_NODE_DEACTIVATE_SHARE,
    payload: { email, role, lndName, password }
  };
}

export function deleteShareUserNodeAccessSuccess(response) {
  return {
    type: SHARE_NODE_DEACTIVATE_SHARE_SUCCESS,
    payload: { response }
  };
}

export function deleteShareUserNodeAccessFail(error) {
  return {
    type: SHARE_NODE_DEACTIVATE_SHARE_FAIL,
    payload: { error }
  };
}

export function getSharedNodeList() {
  return {
    type: SHARE_NODE_GET_NODE_LIST
  };
}

export function getSharedNodeListSuccess(response) {
  return {
    type: SHARE_NODE_GET_NODE_LIST_SUCCESS,
    payload: { response }
  };
}

export function getSharedNodeListFail(error) {
  return {
    type: SHARE_NODE_GET_NODE_LIST_FAIL,
    payload: { error }
  };
}

export function getSharedUserList() {
  return {
    type: SHARE_NODE_GET_USER_LIST
  };
}

export function getSharedUserListSuccess(response) {
  return {
    type: SHARE_NODE_GET_USER_LIST_SUCCESS,
    payload: { response }
  };
}

export function getSharedUserListFail(error) {
  return {
    type: SHARE_NODE_GET_USER_LIST_FAIL,
    payload: { error }
  };
}
