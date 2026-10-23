import {
  SHOW_FUND_NODE_MODAL,
  HIDE_FUND_NODE_MODAL,
  CREATE_DEPOSIT_ADDRESS,
  CREATE_DEPOSIT_ADDRESS_FAILED,
  CREATE_DEPOSIT_ADDRESS_SUCCESS,
} from './FundNodeConstants';

export function showFundNodeModal(nodeName) {
  return { type: SHOW_FUND_NODE_MODAL, payload: { nodeName } };
}

export function hideFundNodeModal() {
  return { type: HIDE_FUND_NODE_MODAL };
}

export function createDepositAddressSuccess(response) {
  return { type: CREATE_DEPOSIT_ADDRESS_SUCCESS, payload: { response } };
}

export function createDepositAddressFailed(error) {
  return { type: CREATE_DEPOSIT_ADDRESS_FAILED, payload: { error } };
}

export function createDepositAddress(nodeName, password, passphrase) {
  return {
    type: CREATE_DEPOSIT_ADDRESS,
    payload: { nodeName, password, passphrase },
  };
}
