/* eslint-disable */
import { call, put, takeLatest, select } from 'redux-saga/effects';
import {
    SHOW_CREATE_NODE_MODAL,
    HIDE_CREATE_NODE_MODAL,
    CREATE_NODE_REQUEST,
    CREATE_NODE_SUCCEEDED,
    CREATE_NODE_FAILED,
    SET_PAYMENT_AND_CREATE_NODE,
} from './CreateNodeConstants';
import Store from "../../store";
import { getNodeList } from "../../managers/nodeManager/nodeActions";

import { createNodeSucceeded, createNodeFailed, createNodeAlert, setPaymentAndCreateNodeSucceeded, setPaymentAndCreateNodeFailed } from './CreateNodeActions';
import { requestCreatePersonalLNDNode, requestCreatePersonalLNDNodeV2 } from '../../requests/Node';
import { enqueueSnackbar, closeSnackbar } from "../Notifier/NotifierActions";

export const getCreateNodeReducer = (state) => state.createNodeReducer

export function* createNode(action) {
    const { payload } = action;

    try {
        const response = yield call(requestCreatePersonalLNDNode, payload);
        if (parseInt(response.status) == 200) {
            yield put(createNodeSucceeded(payload, response));
            yield put(createNodeAlert(null));
        } else {
            yield put(createNodeFailed(response.error));
            yield put(createNodeAlert(response.error));
        }
    } catch (err) {
        yield put(createNodeFailed(err));
        yield put(createNodeAlert(err));
    }
}

export function* createNodeV2(action) {



    let addressExample = 'd0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3eced0d2b817f643eb8a978574c932150571746c59924a72db337d38d904cb79de95c754de09e58db655c7a276263a1b1646a726c4a0bb4bce5a74474ece962f3ece'

    let createNodeReducer = yield select(getCreateNodeReducer);
    let paymentMethod = action.payload.payment.paymentMethodIndex == 0 ? "LND_INVOICE" : "BTC_ADDRESS";
    let data = {...createNodeReducer.info, password: action.payload.password, paymentMethod, ...createNodeReducer.plan }
        // yield put(
        //     enqueueSnackbar({
        //         message: `Creating Node Successfully Started ${JSON.stringify(data)}`,
        //         options: {
        //             variant: "success",
        //             autoHideDuration: 5000,
        //             // persist: true,
        //             // Action has to be a connected component in its own right, e.g
        //             // NotifierCloseButton.  We can't use regular Notistack syntax, e.g.:
        //             // <Button onClick={() => props.closeSnackbar(key)}>dismiss me</Button>
        //             // because we'd have to use put(closeSnackbar()), and put()
        //             // does not work inside of a callback.
        //             // action: < NotifierCloseButton notifierKey = { newKey }
        //             // />
        //         }
        //     })
        // );


    try {
        const response = yield call(requestCreatePersonalLNDNodeV2, {...data });
        if (parseInt(response.status) == 200) {
            yield put(
                enqueueSnackbar({
                    message: `Creating Node Successfully Started`,
                    options: {
                        variant: "success",
                        autoHideDuration: 10000,
                    }
                })
            );
            yield put(setPaymentAndCreateNodeSucceeded(response));
            // try to fetch nodes again
            setTimeout(function() {
                Store.dispatch(getNodeList())
            }, 3000)
        } else {
            throw response
        }
    } catch (err) {

        const errBody = yield err.response.json()

        yield put(setPaymentAndCreateNodeFailed(errBody));

        yield put(
            enqueueSnackbar({
                message: `${errBody.message ? errBody.message : 'An error occurred please try again later'}`,
                options: {
                    variant: "error",
                    autoHideDuration: 10000,
                }
            })
        );


    }
}

export default function* createNodeSaga() {
    yield takeLatest(CREATE_NODE_REQUEST, createNode);
    yield takeLatest(SET_PAYMENT_AND_CREATE_NODE, createNodeV2);
}