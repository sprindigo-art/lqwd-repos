/* eslint-disable */
import {
  SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS,
  SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_SUCCESS,
  SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_FAIL,
  SUBSCRIPTION_GET_CURRENT_INVOICE,
  SUBSCRIPTION_GET_CURRENT_INVOICE_SUCCESS,
  SUBSCRIPTION_GET_CURRENT_INVOICE_FAIL,
  SUBSCRIPTION_GET_PAYMENT_HISTORY,
  SUBSCRIPTION_PAY_RENEWAL,
  SUBSCRIPTION_PAY_RENEWAL_SUCCESS,
  SUBSCRIPTION_PAY_RENEWAL_FAIL,
  SUBSCRIPTION_GET_PAYMENT_HISTORY_SUCCESS,
  SUBSCRIPTION_GET_PAYMENT_HISTORY_FAIL,
  SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST,
  SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_FAIL,
  SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_SUCCESS,
  SUBSCRIPTION_GET_TIERS, SUBSCRIPTION_GET_TIERS_SUCCESS, SUBSCRIPTION_GET_TIERS_FAIL
} from "./SubscriptionConstants";

/* Get Tier Info */
export function getTierInfo(){
  return { type: SUBSCRIPTION_GET_TIERS };
}

export function getTierInfoSuccess(response){
  return { type: SUBSCRIPTION_GET_TIERS_SUCCESS, payload: { response } };
}

export function getTierInfoFail(error){
  return { type: SUBSCRIPTION_GET_TIERS_FAIL, payload: { error } };
}

/* Get Current Active/Suspended Subscriptions */
export function getUserActiveSubscriptions(){
  return { type: SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS };
}

export function getUserActiveSubscriptionsSuccess(response){
  return { type: SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_SUCCESS, payload: { response } };
}

export function getUserActiveSubscriptionsFail(error) {
  return { type: SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS_FAIL, payload: { error } };
}

/* Subscription Renew Pay Request  */
export function paySubscriptionRequest(invoiceId, method){
  return { type: SUBSCRIPTION_PAY_RENEWAL, payload: { invoiceId, method } };
}

export function paySubscriptionRequestSuccess(response){
  return { type: SUBSCRIPTION_PAY_RENEWAL_SUCCESS, payload: { response } };
}

export function paySubscriptionRequestFail(error){
  return { type: SUBSCRIPTION_PAY_RENEWAL_FAIL, payload: { error } };
}

/* Subscription Get Payment History */
export function getSubscriptionPaymentHistory(startDate, endDate){
  return { type: SUBSCRIPTION_GET_PAYMENT_HISTORY, payload: {startDate, endDate} };
}

export function getSubscriptionPaymentHistorySuccess(response){
  return { type: SUBSCRIPTION_GET_PAYMENT_HISTORY_SUCCESS, payload: { response } };
}

export function getSubscriptionPaymentHistoryFail(error){
  return { type: SUBSCRIPTION_GET_PAYMENT_HISTORY_FAIL, payload: { error } };
}

/* Subscription Get Current Invoice */
export function getSubscriptionCurrentInvoice(){
  return { type: SUBSCRIPTION_GET_CURRENT_INVOICE };
}

export function getSubscriptionCurrentInvoiceSuccess(response){
  return { type: SUBSCRIPTION_GET_CURRENT_INVOICE_SUCCESS, payload: { response } };
}

export function getSubscriptionCurrentInvoiceFail(error){
  return { type: SUBSCRIPTION_GET_CURRENT_INVOICE_FAIL, payload: { error } };
}

/* Cancel Subscription Request */
export function cancelSubscription(subscriptionId){
  return { type: SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST, payload: { subscriptionId } };
}

export function cancelSubscriptionSuccess(response){
  return { type: SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_SUCCESS, payload: { response } };
}

export function cancelSubscriptionFail(error){
  return { type: SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST_FAIL, payload: { error } };
}