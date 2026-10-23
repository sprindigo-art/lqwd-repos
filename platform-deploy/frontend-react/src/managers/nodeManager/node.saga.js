/* eslint-disable */
import { call, put, takeLatest, takeEvery } from 'redux-saga/effects';
import store from '../../store';
import {
    getNodeList,
    getNodeListFailed,
    getNodeListSuccess,
    getNodeDetailFailed,
    getNodeDetailSuccess,
    getNodeDetail,
    changeSelectedNode,
    getSharedNodeListSuccess,
    getSharedNodeListFailed,
    getSharedNodeDetail,
    getSharedNodeDetailSuccess, getSharedNodeDetailFailed
} from "./nodeActions";

import { GET_NODE_DETAIL, GET_NODE_LIST, GET_SHARED_NODE_DETAIL, GET_SHARED_NODE_LIST } from "./nodeConstants";

import { requestGetNodeInfo, requestGetUserNodes } from '../../requests/Node';
import { requestGetShareNodeList } from "../../requests/ShareNodeAccess";

export function* getNodeAndDetails() {
    try {
        const response = yield call(requestGetUserNodes);
        // yield put(getNodeListSuccess(response));

        if (parseInt(response.status, 10) === 200) {
            yield put(getNodeListSuccess(response));

            const nodes = JSON.parse(response.object);
            console.log(nodes);
            // check if Node name is null
            if (nodes.length > 0) {
                const name = store.getState().selectedNodeReducer.nodeName;
                const found = nodes.find(item => item.lndNodeName === name);
                if (!found) {
                    yield put(changeSelectedNode(nodes[0].lndNodeName));
                }
            }

            let nodeInCreatingStateFound = false;
            for (let i = 0; i < nodes.length; i += 1) {
                yield put(getNodeDetail(nodes[i].lndNodeName));
                if (nodes[i].status.toLowerCase() === 'CREATING'.toLowerCase()) {
                    nodeInCreatingStateFound = true;
                }
            }
            if (nodeInCreatingStateFound) {
                //TODO: fix this part. https://stackoverflow.com/questions/43853198/retry-functionality-in-redux-saga
                // setTimeout(function() {
                //     put(getNodeList());
                // }, 10000);
            }
        } else {
            yield put(getNodeListFailed(response.error));
        }
    } catch (err) {
        yield put(getNodeListFailed(err));
    }
}


export function* getSharedNodeAndDetails() {
    try {

        const response = yield call(requestGetShareNodeList);

        if (response.status === 200) {
            yield put(getSharedNodeListSuccess(response));

            const nodes = JSON.parse(response.object);

            console.log(nodes);
            if (nodes.length > 0) {
                const name = store.getState().selectedNodeReducer.nodeName;
                if (name == null || name === "") {
                    yield put(changeSelectedNode(nodes[0].lndNodeName));
                }
            }

            let nodeInCreatingStateFound = false;
            for (let i = 0; i < nodes.length; i += 1) {
                yield put(getSharedNodeDetail(nodes[i].lndNodeName));
                if (nodes[i].status.toLowerCase() === 'creating') {
                    nodeInCreatingStateFound = true;
                }
            }
            if (nodeInCreatingStateFound) {
                setTimeout(function() {
                    getSharedNodeAndDetails();
                }, 10000);
            }
        } else {
            yield put(getSharedNodeListFailed(response.error));
        }
    } catch (err) {
        yield put(getSharedNodeListFailed(err));
    }
}


export function* getNodeDetails(action) {
    const { payload } = action;
    try {
        const response = yield call(requestGetNodeInfo, payload);
        yield put(getNodeDetailSuccess(payload.nodeName, response));
    } catch (err) {
        yield put(getNodeDetailFailed(err));
    }
}

export function* getSharedNodeDetails(action) {
    const { payload } = action;
    try {
        const response = yield call(requestGetNodeInfo, payload);
        yield put(getSharedNodeDetailSuccess(payload.nodeName, response));
    } catch (err) {
        yield put(getSharedNodeDetailFailed(err));
    }
}

export default function* myNodeSaga() {
    yield takeLatest(GET_NODE_LIST, getNodeAndDetails);
    yield takeLatest(GET_SHARED_NODE_LIST, getSharedNodeAndDetails);
    yield takeEvery(GET_NODE_DETAIL, getNodeDetails);
    yield takeEvery(GET_SHARED_NODE_DETAIL, getSharedNodeDetails);
}