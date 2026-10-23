/* eslint-disable */
import { call, put, takeLatest } from 'redux-saga/effects';
import {
  MY_CHANNELS_CLOSE_CHANNEL,
  MY_CHANNELS_CONNECT_TO_PEER,
  MY_CHANNELS_CREATE_CHANNEL,
  MY_CHANNELS_GET_CHANNELS,
  MY_CHANNELS_GET_CLOSED_CHANNELS,
  MY_CHANNELS_GET_NODES, MY_CHANNELS_SYNC_CHANNELS
} from "./MyChannelsConstants";

import {
  getChannels,
  getChannelsFail,
  getChannelsSuccess,
  getClosedChannelsFail,
  getClosedChannelsSuccess,
  myChannelsCloseChannelFail,
  myChannelsCloseChannelSuccess,
  myChannelsConnectToPeerFail,
  myChannelsConnectToPeerSuccess,
  myChannelsCreateChannelFail,
  myChannelsCreateChannelSuccess,
  myChannelsListMyNodesFailed,
  myChannelsListMyNodesSuccess,
  selectNode, syncChannelDataFail, syncChannelDataSuccess
} from "./MyChannelsActions";

import {
  requestCloseChannel,
  requestConnectToPeer,
  requestCreateChannel,
  requestGetClosedChannels,
  requestGetNodeChannelsByNode,
  requestGetUserNodesMyChannels, requestSyncChannels
} from "../../requests/MyChannels";

import { getNodeDetail } from "../../managers/nodeManager/nodeActions";
import {requestGetOpenChannel} from "../../requests/Payment";

export function* getUserNodeListMyChannels() {
  try {
    const response = yield call(requestGetUserNodesMyChannels);
    yield put(myChannelsListMyNodesSuccess(response));
    const n = JSON.parse(response.object);
    if (n.length > 0) {
      yield put(selectNode(n[0]));
      yield put(getNodeDetail(n[0].lndNodeName));
      yield put(getChannels(n[0].lndNodeName, null, null));
    }
  } catch (err) {
    yield put(myChannelsListMyNodesFailed(err));
  }
}


export function* getUserChannelsForNode(action){
  const { payload } = action;
  try{
    const response = yield call(requestGetNodeChannelsByNode, payload);
    yield put(getChannelsSuccess(response));

  }catch (err){
    yield put(getChannelsFail(err));
  }
}

export function* getClosedChannelsForNode(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetClosedChannels, payload);
    yield put(getClosedChannelsSuccess(response));
  }catch (err){
    yield put(getClosedChannelsFail(err));
  }
}

export function* connectPeer(action) {
  const { payload } = action;

  try {
    const response = yield call(requestConnectToPeer, payload);
    if (response.status >= 200 && response.status < 300){
      yield put(myChannelsConnectToPeerSuccess(response));
    }else{
      yield put(myChannelsConnectToPeerFail(response.error));
    }
  }catch (err){
    yield put(myChannelsConnectToPeerFail(err));
  }
}

export function* createChannel(action) {
  const { payload } = action;
  try {
    const response = yield call(requestGetOpenChannel, payload);

    // if (response.status == 200){
      yield put(myChannelsCreateChannelSuccess(response));
    // }else{
    //   yield put(myChannelsCreateChannelFail(response));
    // }

  } catch (err) {

    // const reader = err.response.body.getReader();
    // const { value, done } = yield reader.read();
    //
    // if (done) {
      yield put(myChannelsCreateChannelFail(err));
    // } else {
    //   const v = JSON.parse(String.fromCharCode(...value));
    //   yield put(myChannelsCreateChannelFail(v));
    // }
  }
}

export function* closeChannel(action){
  const { payload } = action;
  try {
    const response = yield call(requestCloseChannel, payload);
    yield put(myChannelsCloseChannelSuccess(response));
  }catch (err){
    yield put(myChannelsCloseChannelFail(err));
  }
}

export function* syncChannels(action){
  const { payload } = action;
  try {
    const response = yield call(requestSyncChannels, payload);
    yield put(syncChannelDataSuccess(response));
  }catch (err){
    yield put(syncChannelDataFail(err));
  }
}

export default function* myChannelSaga() {
  yield takeLatest(MY_CHANNELS_GET_CHANNELS, getUserChannelsForNode);
  yield takeLatest(MY_CHANNELS_GET_NODES, getUserNodeListMyChannels);
  yield takeLatest(MY_CHANNELS_GET_CLOSED_CHANNELS, getClosedChannelsForNode);
  yield takeLatest(MY_CHANNELS_CONNECT_TO_PEER, connectPeer);
  yield takeLatest(MY_CHANNELS_CREATE_CHANNEL, createChannel);
  yield takeLatest(MY_CHANNELS_CLOSE_CHANNEL, closeChannel);
  yield takeLatest(MY_CHANNELS_SYNC_CHANNELS, syncChannels);
}