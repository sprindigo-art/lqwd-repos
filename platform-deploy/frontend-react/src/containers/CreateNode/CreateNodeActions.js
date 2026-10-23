import {
  SHOW_CREATE_NODE_MODAL,
  HIDE_CREATE_NODE_MODAL,
  SET_NODE_INFO,
  SET_PLAN,
  CREATE_NODE_REQUEST,
  CREATE_NODE_SUCCEEDED,
  CREATE_NODE_FAILED,
  CREATE_NODE_ALERT,
  CREATE_NODE_ALERT_ACK,
  SET_ACTIVE_STEP,
  SET_PAYMENT_AND_CREATE_NODE,
  SET_PAYMENT_AND_CREATE_NODE_SUCCESS,
  SET_PAYMENT_AND_CREATE_NODE_ERROR,
  SET_SHOW_HINT,
} from './CreateNodeConstants';

export function showCreateNodeModal() {
  return { type: SHOW_CREATE_NODE_MODAL };
}

export function dontShowHintEverAgain() {
  return { type: SET_SHOW_HINT, payload: { dontShowHintAgain: true } };
}

export function hideCreateNodeModal() {
  return { type: HIDE_CREATE_NODE_MODAL };
}

export const tryCreateNode = payload => ({
  type: CREATE_NODE_REQUEST,
  payload,
});

export const setNodeInfo = payload => ({
  type: SET_NODE_INFO,
  payload,
});

export const setActiveStep = step => ({
  type: SET_ACTIVE_STEP,
  payload: step,
});

export const setNodePlan = payload => ({
  type: SET_PLAN,
  payload,
});
export const setPaymentAndCreateNode = payload => ({
  type: SET_PAYMENT_AND_CREATE_NODE,
  payload,
});
export const setPaymentAndCreateNodeSucceeded = payload => ({
  type: SET_PAYMENT_AND_CREATE_NODE_SUCCESS,
  payload,
});
export const setPaymentAndCreateNodeFailed = error => ({
  type: SET_PAYMENT_AND_CREATE_NODE_ERROR,
  payload: { error },
});

export function createNodeSucceeded(data, response) {
  return { type: CREATE_NODE_SUCCEEDED, payload: { data, response } };
}

export function createNodeFailed(error) {
  return { type: CREATE_NODE_FAILED, payload: { error } };
}

export function createNodeAlert(error) {
  return { type: CREATE_NODE_ALERT, payload: { error } };
}

export function createNodeAlertAck() {
  return { type: CREATE_NODE_ALERT_ACK };
}
