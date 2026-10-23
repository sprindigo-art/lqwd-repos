/* eslint-disable */
import { call, put, select, takeLatest } from 'redux-saga/effects';
import { requestGetAllInvoices } from "../../requests/Transactions";

import {
    getAllTransactionsSucceeded,
    getAllTransactionsFailed,
} from "./TransactionsPageActions";

import { TRANSACTIONS_GET_ALL } from "./TransactionsPageConstants";

const baseURL = process.env.REACT_APP_DLA_BASE_URL;

export function* getAllTransactionsFunc() {
    try {
        const response = yield call(requestGetAllInvoices);
        yield put(getAllTransactionsSucceeded(response));
    } catch (err) {
        yield put(getAllTransactionsFailed(err));
    }
}


export default function* signupPageSaga() {
    yield takeLatest(TRANSACTIONS_GET_ALL, getAllTransactionsFunc);
}