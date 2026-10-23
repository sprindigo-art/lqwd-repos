/* eslint-disable no-console */
import {
  SEND_PAYMENT_KEY_SEND_ACTIVE_STEP,
  SEND_PAYMENT_KEY_SEND_PAY,
  SEND_PAYMENT_KEY_SEND_PAY_FAILED,
  SEND_PAYMENT_KEY_SEND_PAY_SUCCESS,
  SEND_PAYMENT_KEY_SEND_SELECT_NODE,
  SEND_PAYMENT_KEY_SEND_UPDATE_INFO,
} from './PayKeySendConstants';

export function sendPaymentKeySendSelectNode(node) {
  return { type: SEND_PAYMENT_KEY_SEND_SELECT_NODE, payload: { node } };
}

export function sendPaymentKeySendUpdateInfo(amount, destination) {
  return {
    type: SEND_PAYMENT_KEY_SEND_UPDATE_INFO,
    payload: { amount, destination },
  };
}

export function sendPaymentKeySendNextStep(index) {
  return { type: SEND_PAYMENT_KEY_SEND_ACTIVE_STEP, payload: { index } };
}

export function sendPaymentKeySendPay(request, nodeName) {
  return {
    type: SEND_PAYMENT_KEY_SEND_PAY,
    payload: { request, nodeName },
  };
}

export function sendPaymentKeySendPayFailed(error) {
  return {
    type: SEND_PAYMENT_KEY_SEND_PAY_FAILED,
    payload: { error },
  };
}

export function sendPaymentKeySendPaySuccess(response) {
  return {
    type: SEND_PAYMENT_KEY_SEND_PAY_SUCCESS,
    payload: { response },
  };
}
