/* eslint-disable */
import {
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS,
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS_FAIL,
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS_SUCCESS,
  SIGNUP_PAGE_LOGGED_IN,
  SIGNUP_PAGE_MFA_LOGIN,
  SIGNUP_PAGE_MFA_LOGIN_FAIL,
  SIGNUP_PAGE_MFA_LOGIN_SUCCESS
} from "./SignupPageConstant";

export function getCurrentNumberRegistered(){
  return { type: SIGNUP_PAGE_GET_NUM_BETA_SPOTS };
}

export function getCurrentNumberRegisteredFail(error) {
  return { type: SIGNUP_PAGE_GET_NUM_BETA_SPOTS_FAIL, payload: { error } };
}

export function getCurrentNumberRegisteredSuccess(response) {
  return { type: SIGNUP_PAGE_GET_NUM_BETA_SPOTS_SUCCESS, payload: { response } };
}

export function signupPageLogin(username, password, mfaCode) {
  return { type: SIGNUP_PAGE_MFA_LOGIN, payload : { username, password, mfaCode}};
}

export function signupPageLoginSuccess(response) {
  return { type: SIGNUP_PAGE_MFA_LOGIN_SUCCESS, payload: { response }};
}

export function signupPageLoginFail(error) {
  return { type: SIGNUP_PAGE_MFA_LOGIN_FAIL, payload: { error }};
}

export function signupLoggedIn() {
  return { type: SIGNUP_PAGE_LOGGED_IN };
}
