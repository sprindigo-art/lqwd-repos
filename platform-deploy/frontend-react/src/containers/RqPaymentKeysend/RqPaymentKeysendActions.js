/* eslint-disable no-console */
import {
  RQ_PAYMENT_KEY_GET_INVOICES,
  RQ_PAYMENT_KEY_GET_INVOICES_FAILED,
  RQ_PAYMENT_KEY_GET_INVOICES_SUCCESS,
  RQ_PAYMENT_KEY_RESET,
  RQ_PAYMENT_KEY_SELECT_NODE,
  RQ_PAYMENT_KEY_SEND_EMAIL,
  RQ_PAYMENT_KEY_SEND_EMAIL_FAILED,
  RQ_PAYMENT_KEY_SEND_EMAIL_SUCCESS,
  RQ_PAYMENT_KEY_SET_EMAIL,
  RQ_PAYMENT_KEY_SET_NODE_ADDRESS,
  RQ_PAYMENT_KEY_SHOW_EMAIL_DIALOG,
  RQ_PAYMENT_KEY_SHOW_SUCCESS_DIALOG,
} from './RqPaymentKeysendConstants';

export function rqPaymentKeySendEmail(nodeAddress, emailAddress) {
  return {
    type: RQ_PAYMENT_KEY_SEND_EMAIL,
    payload: {
      nodeAddress,
      emailAddress,
    },
  };
}

export function rqPaymentKeySendEmailFailed(error) {
  return {
    type: RQ_PAYMENT_KEY_SEND_EMAIL_FAILED,
    payload: { error },
  };
}

export function rqPaymentKeySendEmailSuccess(response) {
  return {
    type: RQ_PAYMENT_KEY_SEND_EMAIL_SUCCESS,
    payload: { response },
  };
}

export function rqPaymentKeyReset() {
  return { type: RQ_PAYMENT_KEY_RESET };
}

export function rqPaymentKeySetEmail(email) {
  return { type: RQ_PAYMENT_KEY_SET_EMAIL, payload: { email } };
}

export function rqPaymentKeyShowEmailDialog(show) {
  return { type: RQ_PAYMENT_KEY_SHOW_EMAIL_DIALOG, payload: { show } };
}

export function rqPaymentKeyShowSuccessDialog(show) {
  return { type: RQ_PAYMENT_KEY_SHOW_SUCCESS_DIALOG, payload: { show } };
}

export function rqPaymentKeySetNodeAddress(nodeAddress) {
  return { type: RQ_PAYMENT_KEY_SET_NODE_ADDRESS, payload: { nodeAddress } };
}

export function rqPaymentKeySelectNode(node) {
  return { type: RQ_PAYMENT_KEY_SELECT_NODE, payload: { node } };
}

export function rqPaymentKeyGetInvoices(keySend) {
  return {
    type: RQ_PAYMENT_KEY_GET_INVOICES,
    payload: {
      keySend,
    },
  };
}

export function rqPaymentKeyInvoicesFailed(error) {
  return {
    type: RQ_PAYMENT_KEY_GET_INVOICES_FAILED,
    payload: { error },
  };
}

export function rqPaymentKeyeGetInvoicesSuccess(response) {
  return {
    type: RQ_PAYMENT_KEY_GET_INVOICES_SUCCESS,
    payload: { response },
  };
}
