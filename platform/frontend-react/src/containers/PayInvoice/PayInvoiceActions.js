/* eslint-disable no-console */
import {
  SEND_PAYMENT_CHANNEL_DATA_CHANGED,
  SEND_PAYMENT_DECODE_INVOICE,
  SEND_PAYMENT_DECODE_INVOICE_FAILED,
  SEND_PAYMENT_DECODE_INVOICE_SUCCESS,
  SEND_PAYMENT_GET_AVAILABLE_CHANNEL,
  SEND_PAYMENT_GET_AVAILABLE_CHANNEL_FAILED,
  SEND_PAYMENT_GET_AVAILABLE_CHANNEL_SUCCESS,
  SEND_PAYMENT_OPEN_CHANNEL,
  SEND_PAYMENT_OPEN_CHANNEL_FAILED,
  SEND_PAYMENT_OPEN_CHANNEL_SUCCESS,
  SEND_PAYMENT_PAY,
  SEND_PAYMENT_PAY_FAILED,
  SEND_PAYMENT_PAY_SUCCESS,
  SEND_PAYMENT_QUERY_ROUTE,
  SEND_PAYMENT_QUERY_ROUTE_FAILED,
  SEND_PAYMENT_QUERY_ROUTE_SUCCESS,
  SEND_PAYMENT_RESET,
  SEND_PAYMENT_SELECT_NODE,
  SEND_PAYMENT_SET_ACTIVE_STEP,
  SEND_PAYMENT_SHOW_STEP,
  SEND_PAYMENT_TOGGLE_AUTH,
  SEND_PAYMENT_UPDATE_INVOICE,
} from './PayInvoiceConstants';

export function sendPaymentSelectNode(node) {
  return { type: SEND_PAYMENT_SELECT_NODE, payload: { node } };
}

export function sendPaymentUpdateInvoice(paymentRequest) {
  return { type: SEND_PAYMENT_UPDATE_INVOICE, payload: { paymentRequest } };
}

export function sendPaymentDecodeInvoice(invoice, nodeName) {
  return { type: SEND_PAYMENT_DECODE_INVOICE, payload: { invoice, nodeName } };
}

export function sendPaymentDecodeInvoiceFailed(error) {
  return { type: SEND_PAYMENT_DECODE_INVOICE_FAILED, payload: { error } };
}

export function sendPaymentDecodeInvoiceSuccess(response, nodeName) {
  return {
    type: SEND_PAYMENT_DECODE_INVOICE_SUCCESS,
    payload: { response, nodeName },
  };
}

export function sendPaymentOpenChannel(
  channelRequest,
  paymentRequest,
  nodeName
) {
  return {
    type: SEND_PAYMENT_OPEN_CHANNEL,
    payload: { channelRequest, paymentRequest, nodeName },
  };
}

export function sendPaymentOpenChannelFailed(error) {
  return { type: SEND_PAYMENT_OPEN_CHANNEL_FAILED, payload: { error } };
}

export function sendPaymentOpenChannelSuccess(
  response,
  paymentRequest,
  nodeName
) {
  const request = {
    payment_request: paymentRequest,
    timeout_seconds: 20,
  };
  return {
    type: SEND_PAYMENT_OPEN_CHANNEL_SUCCESS,
    payload: { response, request, nodeName },
  };
}

export function sendPaymentChannelDataChanged(data) {
  return { type: SEND_PAYMENT_CHANNEL_DATA_CHANGED, payload: { data } };
}

export function sendPaymentQueryRoute(pubKey, amount, nodeName) {
  return {
    type: SEND_PAYMENT_QUERY_ROUTE,
    payload: { pubKey, amount, nodeName },
  };
}

export function sendPaymentQueryRouteFailed(error) {
  return { type: SEND_PAYMENT_QUERY_ROUTE_FAILED, payload: { error } };
}

export function sendPaymentQueryRouteSuccess(response) {
  return {
    type: SEND_PAYMENT_QUERY_ROUTE_SUCCESS,
    payload: { response },
  };
}

export function sendPaymentActiveStep(index) {
  return { type: SEND_PAYMENT_SET_ACTIVE_STEP, payload: { index } };
}

export function sendPaymentShowStep(show) {
  return { type: SEND_PAYMENT_SHOW_STEP, payload: { show } };
}

export function sendPaymentReset() {
  return { type: SEND_PAYMENT_RESET };
}

export function sendPaymentPay(paymentRequest, nodeName, password, passphrase) {
  const request = {
    payment_request: paymentRequest,
    timeout_seconds: 20,
  };
  return {
    type: SEND_PAYMENT_PAY,
    payload: { request, nodeName, password, passphrase },
  };
}

export function sendPaymentPayFailed(error) {
  return {
    type: SEND_PAYMENT_PAY_FAILED,
    payload: { error },
  };
}

export function sendPaymentPaySuccess(response) {
  return {
    type: SEND_PAYMENT_PAY_SUCCESS,
    payload: { response },
  };
}

export function sendPaymentToggleAuth() {
  return {
    type: SEND_PAYMENT_TOGGLE_AUTH,
  };
}
