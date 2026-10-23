import {
  SHOW_TRANSACTION_DETAILS_MODAL,
  HIDE_TRANSACTION_DETAILS_MODAL,
} from './TransactionDetailsConstants';

export const showTransactionDetailsAction = transaction => ({
  type: SHOW_TRANSACTION_DETAILS_MODAL,
  payload: { transaction },
});

export function hideTransactionDetails() {
  return { type: HIDE_TRANSACTION_DETAILS_MODAL };
}
