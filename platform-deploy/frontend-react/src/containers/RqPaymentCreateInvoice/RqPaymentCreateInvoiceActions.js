/* eslint-disable no-console */
import {
  RQ_PAYMENT_INVOICE_AMOUNT_CHANGED,
  RQ_PAYMENT_INVOICE_CREATE_INVOICE,
  RQ_PAYMENT_INVOICE_CREATE_INVOICE_FAILED,
  RQ_PAYMENT_INVOICE_CREATE_INVOICE_SUCCESS,
  RQ_PAYMENT_INVOICE_GET_INVOICES,
  RQ_PAYMENT_INVOICE_GET_INVOICES_FAILED,
  RQ_PAYMENT_INVOICE_GET_INVOICES_SUCCESS,
  RQ_PAYMENT_INVOICE_RESET,
  RQ_PAYMENT_INVOICE_SELECT_NODE,
  RQ_PAYMENT_INVOICE_SEND_EMAIL,
  RQ_PAYMENT_INVOICE_SEND_EMAIL_FAILED,
  RQ_PAYMENT_INVOICE_SEND_EMAIL_SUCCESS,
  RQ_PAYMENT_INVOICE_SET_EMAIL,
  RQ_PAYMENT_INVOICE_SHOW_EMAIL_DIALOG,
  RQ_PAYMENT_INVOICE_SHOW_SUCCESS_DIALOG,
} from './RqPaymentCreateInvoiceConstants';

export function rqPaymentInvoiceSelectNode(node) {
  return { type: RQ_PAYMENT_INVOICE_SELECT_NODE, payload: { node } };
}

export function rqPaymentInvoiceAmountChange(amt) {
  return { type: RQ_PAYMENT_INVOICE_AMOUNT_CHANGED, payload: { amt } };
}

export function rqPaymentInvoiceCreateNode(
  amount,
  nodeName,
  password,
  passphrase
) {
  return {
    type: RQ_PAYMENT_INVOICE_CREATE_INVOICE,
    payload: { amount, nodeName, password, passphrase },
  };
}

export function rqPaymentInvoiceCreateNodeFailed(error) {
  return {
    type: RQ_PAYMENT_INVOICE_CREATE_INVOICE_FAILED,
    payload: { error },
  };
}

export function rqPaymentInvoiceCreateNodeSuccess(response) {
  return {
    type: RQ_PAYMENT_INVOICE_CREATE_INVOICE_SUCCESS,
    payload: { response },
  };
}

export function rqPaymentInvoiceSendEmail(
  amount,
  invoiceBase64,
  emailAddress,
  invoiceAddress,
  payRequest
) {
  return {
    type: RQ_PAYMENT_INVOICE_SEND_EMAIL,
    payload: {
      amount,
      invoiceBase64,
      invoiceAddress,
      emailAddress,
      payRequest,
    },
  };
}

export function rqPaymentInvoiceSendEmailFailed(error) {
  return {
    type: RQ_PAYMENT_INVOICE_SEND_EMAIL_FAILED,
    payload: { error },
  };
}

export function rqPaymentInvoiceSendEmailSuccess(response) {
  return {
    type: RQ_PAYMENT_INVOICE_SEND_EMAIL_SUCCESS,
    payload: { response },
  };
}

export function rqPaymentInvoiceGetInvoices(keySend) {
  return {
    type: RQ_PAYMENT_INVOICE_GET_INVOICES,
    payload: {
      keySend,
    },
  };
}

export function rqPaymentInvoiceGetInvoicesFailed(error) {
  return {
    type: RQ_PAYMENT_INVOICE_GET_INVOICES_FAILED,
    payload: { error },
  };
}

export function rqPaymentInvoiceGetInvoicesSuccess(response) {
  return {
    type: RQ_PAYMENT_INVOICE_GET_INVOICES_SUCCESS,
    payload: { response },
  };
}

export function rqPaymentInvoiceReset() {
  return { type: RQ_PAYMENT_INVOICE_RESET };
}

export function rqPaymentSetEmail(email) {
  return { type: RQ_PAYMENT_INVOICE_SET_EMAIL, payload: { email } };
}

export function rqPaymentShowEmailDialog(show) {
  return { type: RQ_PAYMENT_INVOICE_SHOW_EMAIL_DIALOG, payload: { show } };
}

export function rqPaymentShowSuccessDialog(show) {
  return { type: RQ_PAYMENT_INVOICE_SHOW_SUCCESS_DIALOG, payload: { show } };
}
