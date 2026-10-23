/* eslint-disable no-console */
import {
  WITHDRAW_ACTIVE_STEP,
  WITHDRAW_HIDE_AUTHORIZE_MODAL,
  WITHDRAW_RESET,
  WITHDRAW_SELECT_NODE,
  WITHDRAW_SEND_COINS,
  WITHDRAW_SEND_COINS_FAILED,
  WITHDRAW_SEND_COINS_SUCCESS,
  WITHDRAW_SHOW_AUTHORIZE_MODAL,
  WITHDRAW_UPDATE_INFO,
} from './WithdrawConstants';

export function withdrawSelectNode(node) {
  return { type: WITHDRAW_SELECT_NODE, payload: { node } };
}

export function withdrawUpdateInfo(amount, destination) {
  return {
    type: WITHDRAW_UPDATE_INFO,
    payload: { amount, destination },
  };
}

export function withdrawNextStep(index) {
  return { type: WITHDRAW_ACTIVE_STEP, payload: { index } };
}

export function withdrawSendCoins(request, nodeName, password, passphrase) {
  return {
    type: WITHDRAW_SEND_COINS,
    payload: { request, nodeName, password, passphrase },
  };
}

export function withdrawSendCoinsFailed(error) {
  return {
    type: WITHDRAW_SEND_COINS_FAILED,
    payload: { error },
  };
}

export function withdrawSendCoinsSuccess(response) {
  return {
    type: WITHDRAW_SEND_COINS_SUCCESS,
    payload: { response },
  };
}

export function withdrawReset() {
  return {
    type: WITHDRAW_RESET,
  };
}

export function withdrawShowAuthModal() {
  return {
    type: WITHDRAW_SHOW_AUTHORIZE_MODAL,
  };
}

export function withdrawHideAuthModal() {
  return {
    type: WITHDRAW_HIDE_AUTHORIZE_MODAL,
  };
}
