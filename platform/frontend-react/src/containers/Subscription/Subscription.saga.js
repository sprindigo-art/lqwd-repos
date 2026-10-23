/* eslint-disable */
import { call, put, select, takeLatest, takeEvery } from 'redux-saga/effects';

import {
  cancelSubscriptionFail,
  cancelSubscriptionSuccess,
  getSubscriptionCurrentInvoiceFail,
  getSubscriptionCurrentInvoiceSuccess,
  getSubscriptionPaymentHistoryFail,
  getSubscriptionPaymentHistorySuccess,
  getTierInfoFail,
  getTierInfoSuccess,
  getUserActiveSubscriptionsFail,
  getUserActiveSubscriptionsSuccess,
  paySubscriptionRequestFail,
  paySubscriptionRequestSuccess
} from "./SubscriptionActions";

import {
  SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST,
  SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS,
  SUBSCRIPTION_GET_CURRENT_INVOICE,
  SUBSCRIPTION_GET_PAYMENT_HISTORY,
  SUBSCRIPTION_GET_TIERS,
  SUBSCRIPTION_PAY_RENEWAL
} from "./SubscriptionConstants";

import {
  requestCancelSubscription,
  requestGetActiveSubscription,
  requestGetCurrentInvoice,
  requestGetPaymentHistory,
  requestGetTierInfo,
  requestPaySubscription
} from "../../requests/Subscription";

/* Get Tier Info */
export function* getSubscriptionTierInfo() {
  try {
    const response = yield call(requestGetTierInfo);
    yield put(getTierInfoSuccess(response));
  } catch (err) {
    yield put(getTierInfoFail(err));
  }
}

/* Get Active/Suspended Subscriptions */
export function* getActiveSubscriptions() {
  try {
    const response = yield call(requestGetActiveSubscription);
    yield put(getUserActiveSubscriptionsSuccess(response));
  } catch (err) {
    yield put(getUserActiveSubscriptionsFail(err));
  }
}

/* Get Current Invoice for Bill Detail */
export function* getCurrentInvoice(){
  try {
    const response = yield call(requestGetCurrentInvoice);
    console.log(response);
    if (response.success){
      yield put(getSubscriptionCurrentInvoiceSuccess(response));
    }
    yield put(getSubscriptionCurrentInvoiceFail(response));
  }catch (err){
    yield put(getSubscriptionCurrentInvoiceFail(err));
  }
}

/* Get Payment History */
export function* getPaymentHistory(action){
  try {
    const response = yield call(requestGetPaymentHistory, action);
    console.log(response);
    if(response.success){
      yield put(getSubscriptionPaymentHistorySuccess(response));
    }
    yield put(getSubscriptionPaymentHistoryFail(response));
  }catch (err){
    yield put(getSubscriptionPaymentHistoryFail(err));
  }
}

/* Pay Subscribe Request */
export function* paySubscribeRequest(action){
  try {
    const response = yield call(requestPaySubscription, action);
    yield put(paySubscriptionRequestSuccess(response));
  }catch (err){
    yield put(paySubscriptionRequestFail(err));
  }
}

/* Cancel Subscription Request */
export function* cancelSubscriptionRequest(action){
  try {
    const response = yield call(requestCancelSubscription, action);
    console.log(response);
    if (response.status === 200){
      yield put(cancelSubscriptionSuccess(response));
    }else{
      console.log(response);
      yield put(cancelSubscriptionFail(response));
    }
  }catch (err){
    yield put(cancelSubscriptionFail(err));
  }
}

export default function* subscribeSaga() {
  yield takeLatest(SUBSCRIPTION_GET_TIERS, getSubscriptionTierInfo);
  yield takeLatest(SUBSCRIPTION_GET_ACTIVE_SUBSCRIPTIONS, getActiveSubscriptions);
  yield takeLatest(SUBSCRIPTION_GET_CURRENT_INVOICE, getCurrentInvoice);
  yield takeLatest(SUBSCRIPTION_GET_PAYMENT_HISTORY, getPaymentHistory);
  yield takeLatest(SUBSCRIPTION_PAY_RENEWAL, paySubscribeRequest);
  yield takeLatest(SUBSCRIPTION_CANCEL_SUBSCRIPTION_REQUEST, cancelSubscriptionRequest);
}