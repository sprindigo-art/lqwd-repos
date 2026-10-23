/* eslint-disable */
import {
  VERIFY_PAGE_GET_EMAIL,
  VERIFY_PAGE_GET_EMAIL_FAIL,
  VERIFY_PAGE_GET_EMAIL_SUCCESS,
  VERIFY_PAGE_SEND,
  VERIFY_PAGE_SEND_FAIL,
  VERIFY_PAGE_SEND_SUCCESS
} from "./VerifyPageConstants";

export function verifyGetEmail(){
 return { type: VERIFY_PAGE_GET_EMAIL};
}

export function verifyGetEmailSuccess(response){
  console.log(response);
  return {type: VERIFY_PAGE_GET_EMAIL_SUCCESS, payload: { response }};
}

export function verifyGetEmailFail(error){
  return {type: VERIFY_PAGE_GET_EMAIL_FAIL, payload: { error }};
}

export function verifySendEmail(email){
  return { type: VERIFY_PAGE_SEND, payload: { email } };
}

export function verifySendEmailSuccess(response){
  return { type: VERIFY_PAGE_SEND_SUCCESS, payload: { response } };
}

export function verifySendEmailFail(error){
  return { type: VERIFY_PAGE_SEND_FAIL, payload: { error} };
}