/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
    CREATE_DEPOSIT_ADDRESS,
} from './FundNodeConstants';

import {
    createDepositAddressSuccess,
    createDepositAddressFailed
} from './FundNodeActions';

import { enqueueSnackbar, closeSnackbar } from "../Notifier/NotifierActions";
import { requestCreateDepositAddress } from '../../requests/Node';

export function* generateAddress(action) {
    const { payload } = action;

    try {
        const response = yield call(requestCreateDepositAddress, payload);
        if (parseInt(response.status) == 200) {
            yield put(createDepositAddressSuccess(response));
        } else {
            yield put(
                enqueueSnackbar({
                    message: `Getting address failed ${response.error? JSON.stringify(response.error): ''}`,
                    options: {
                        variant: "error",
                        autoHideDuration: 10000,
                    }
                })
            );
            yield put(createDepositAddressFailed(response.error));
        }
    } catch (err) {
        yield put(
            enqueueSnackbar({
                message: `Getting address failed ${JSON.stringify(err)}`,
                options: {
                    variant: "error",
                    autoHideDuration: 10000,
                }
            })
        );
        yield put(createDepositAddressFailed(err));
    }

}


export default function* fundNodeModalSaga() {
    yield takeLatest(CREATE_DEPOSIT_ADDRESS, generateAddress);
}