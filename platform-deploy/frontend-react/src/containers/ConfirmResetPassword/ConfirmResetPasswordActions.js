import {
  CONFIRM_PASS,
  CONFIRM_PASS_FAIL,
  CONFIRM_PASS_SUCCESS,
} from './ConfirmResetPasswordConstants';

export function confirmResetPassword(password, token) {
  return { type: CONFIRM_PASS, payload: { password, token } };
}

export function confirmResetPasswordSuccess(response) {
  return { type: CONFIRM_PASS_SUCCESS, payload: { response } };
}

export function confirmResetPasswordFail(error) {
  return { type: CONFIRM_PASS_FAIL, payload: { error } };
}
