import {
  TRANSACTIONS_APPLY_FILTER,
  TRANSACTIONS_GET_ALL,
  TRANSACTIONS_GET_ALL_FAIL,
  TRANSACTIONS_GET_ALL_SUCCESS,
} from './TransactionsPageConstants';

export function transactionsApplyFilter(newfilter) {
  return { type: TRANSACTIONS_APPLY_FILTER, payload: { fiter: newfilter } };
}

export function getAllTransactions() {
  return { type: TRANSACTIONS_GET_ALL };
}
export function getAllTransactionsFailed(error) {
  return { type: TRANSACTIONS_GET_ALL_FAIL, payload: { error } };
}

export function getAllTransactionsSucceeded(response) {
  return { type: TRANSACTIONS_GET_ALL_SUCCESS, payload: { response } };
}
