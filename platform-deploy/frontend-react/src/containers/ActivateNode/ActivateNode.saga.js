/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
    SHOW_ACTIVATE_MODAL,
    HIDE_ACTIVATE_MODAL,
    GET_SEEDS_FOR_ACTIVATION,
    ACTIVATION_SEEDS_SUCCESS,
    ACTIVATION_SEEDS_ERROR,
    ACTIVATE_NODE_REQUEST,
    ACTIVATE_NODE_SUCCEEDED,
    ACTIVATE_NODE_FAILED,
} from './ActivateNodeConstants';
import Store from "../../store";
import { getNodeList } from "../../managers/nodeManager/nodeActions";
import { enqueueSnackbar, closeSnackbar } from "../Notifier/NotifierActions";

import { getSeedsSucceeded, getSeedsFailed, confirmSeedsSucceeded, confirmSeedsFailed, ActivateModalExpired } from './ActivateNodeActions';

import { requestGetSeeds, requestConfirmSeeds } from '../../requests/Node';

export function* getSeedsForActivation(action) {
    const { payload } = action;
    try {
        const response = yield call(requestGetSeeds, payload);
        let numberList = [];
        while (numberList.length < 3) {
            const number = Math.floor(Math.random() * 23);
            if (!numberList.includes(number)) {
                numberList.push(number);
            }
        }
        numberList = numberList.sort(function(a, b) {
            return a - b;
        });
        response.confirmationSeedsIndexes = numberList;
        if (parseInt(response.status) == 200) {
            yield put(getSeedsSucceeded(payload, response));
        } else {
            if (response['object'] === 'Cannot get seed') {
                yield put(ActivateModalExpired());
            } else {
                yield put(getSeedsFailed(response.error));
            }
        }
    } catch (err) {
        yield put(getSeedsFailed(err));
    }
}

export function* activateNode(action) {
    const { payload } = action;

    try {
        const response = yield call(requestConfirmSeeds, payload);
        if (parseInt(response.status) == 200) {
            yield put(
                enqueueSnackbar({
                    message: `Seeds Successfully Confirmed`,
                    options: {
                        variant: "success",
                        autoHideDuration: 10000,
                    }
                })
            );
            yield put(confirmSeedsSucceeded(payload, response));
            setTimeout(function() {
                Store.dispatch(getNodeList())
            }, 3000)
        } else {
            yield put(
                enqueueSnackbar({
                    message: `Confirming seeds failed ${response.error? JSON.stringify(response.error): ''}`,
                    options: {
                        variant: "error",
                        autoHideDuration: 10000,
                    }
                })
            );
            yield put(confirmSeedsFailed(response.error));
        }
    } catch (err) {
        yield put(
            enqueueSnackbar({
                message: `Confirming seeds failed ${JSON.stringify(err)}`,
                options: {
                    variant: "error",
                    autoHideDuration: 10000,
                }
            })
        );
        yield put(confirmSeedsFailed(err));
    }
}


export default function* activateModalSaga() {
    yield takeLatest(GET_SEEDS_FOR_ACTIVATION, getSeedsForActivation);
    yield takeLatest(ACTIVATE_NODE_REQUEST, activateNode);
}