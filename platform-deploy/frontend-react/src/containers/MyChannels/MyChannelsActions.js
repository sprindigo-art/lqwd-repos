/* eslint-disable */
import {
  MY_CHANNELS_CHANGE_INDEX,
  MY_CHANNELS_CHANNEL_DATA_CHANGED,
  MY_CHANNELS_CLOSE_CHANNEL, MY_CHANNELS_CLOSE_CHANNEL_FAIL, MY_CHANNELS_CLOSE_CHANNEL_SUCCESS,
  MY_CHANNELS_CONNECT_TO_PEER,
  MY_CHANNELS_CONNECT_TO_PEER_FAIL,
  MY_CHANNELS_CONNECT_TO_PEER_SUCCESS,
  MY_CHANNELS_CREATE_CHANNEL,
  MY_CHANNELS_CREATE_CHANNEL_FAIL,
  MY_CHANNELS_CREATE_CHANNEL_SUCCESS,
  MY_CHANNELS_GET_CHANNEL_DETAIL,
  MY_CHANNELS_GET_CHANNEL_DETAIL_FAIL,
  MY_CHANNELS_GET_CHANNEL_DETAIL_SUCCESS,
  MY_CHANNELS_GET_CHANNELS,
  MY_CHANNELS_GET_CHANNELS_FAIL,
  MY_CHANNELS_GET_CHANNELS_SUCCESS,
  MY_CHANNELS_GET_CLOSED_CHANNELS,
  MY_CHANNELS_GET_CLOSED_CHANNELS_FAIL,
  MY_CHANNELS_GET_CLOSED_CHANNELS_SUCCESS,
  MY_CHANNELS_GET_NODES,
  MY_CHANNELS_GET_NODES_FAILED,
  MY_CHANNELS_GET_NODES_SUCCESS,
  MY_CHANNELS_GET_NUM_TOTAL_CHANNELS, MY_CHANNELS_RESET_CHANNEL_DATA,
  MY_CHANNELS_SELECT_NODE, MY_CHANNELS_SHOW_AUTHORIZE_MODAL
} from "./MyChannelsConstants";

export function getNumTotalChannels(){
  return { type: MY_CHANNELS_GET_NUM_TOTAL_CHANNELS };
}

export function getChannels(nodeName, channelTable, filterOptions, search){
  return { type: MY_CHANNELS_GET_CHANNELS, payload: { nodeName, channelTable, filterOptions, search } };
}

export function getChannelsFail(error) {
  return { type: MY_CHANNELS_GET_CHANNELS_FAIL, payload: { error } };
}

export function getChannelsSuccess(response) {
  return { type: MY_CHANNELS_GET_CHANNELS_SUCCESS, payload: { response } };
}

export function getChannelDetail(nodeName, channelId) {
  return { type: MY_CHANNELS_GET_CHANNEL_DETAIL, payload: { nodeName, channelId } };
}

export function getChannelDetailFail(error) {
  return { type: MY_CHANNELS_GET_CHANNEL_DETAIL_FAIL, payload: { error } };
}

export function getChannelDetailSuccess(channelId, response) {
  return { type: MY_CHANNELS_GET_CHANNEL_DETAIL_SUCCESS, payload: { channelId, response } };
}

export function getClosedChannels (channelTable){
  return { type: MY_CHANNELS_GET_CLOSED_CHANNELS, payload: { channelTable }};
}

export function getClosedChannelsFail (error){
  return { type: MY_CHANNELS_GET_CLOSED_CHANNELS_FAIL, payload: { error }};
}

export function getClosedChannelsSuccess (response){
  return { type: MY_CHANNELS_GET_CLOSED_CHANNELS_SUCCESS, payload: { response }};
}

export function myChannelsChannelDataChanged(data) {
  return { type: MY_CHANNELS_CHANNEL_DATA_CHANGED, payload: { data } };
}

export function getMyChannelsNodes() {
  return { type: MY_CHANNELS_GET_NODES };
}

export function myChannelsListMyNodesFailed(error) {
  return { type: MY_CHANNELS_GET_NODES_FAILED, payload: { error } };
}

export function myChannelsListMyNodesSuccess(response) {
  return { type: MY_CHANNELS_GET_NODES_SUCCESS, payload: { response } };
}

export function selectNode(node) {
  return { type: MY_CHANNELS_SELECT_NODE, payload: { node } };
}

/* Actions for Channel Creation */
export function myChannelsCreateChannelAction(channelRequest, password, passphrase) {
  return { type: MY_CHANNELS_CREATE_CHANNEL, payload: { channelRequest, password, passphrase } };
}

export function myChannelsCreateChannelSuccess(response) {
  return { type: MY_CHANNELS_CREATE_CHANNEL_SUCCESS, payload: { response } };
}

export function myChannelsCreateChannelFail(error) {
  return { type: MY_CHANNELS_CREATE_CHANNEL_FAIL, payload: { error } };
}

/* Actions for Creating Peer Connection */
export function myChannelsConnectToPeer(localNode, remoteNode) {
  return { type: MY_CHANNELS_CONNECT_TO_PEER, payload: { localNode, remoteNode } };
}

export function myChannelsConnectToPeerSuccess(response) {
  return { type: MY_CHANNELS_CONNECT_TO_PEER_SUCCESS, payload: { response } };
}

export function myChannelsConnectToPeerFail(error) {
  return { type: MY_CHANNELS_CONNECT_TO_PEER_FAIL, payload: { error } };
}

export function myChannelsCloseChannel(channelData, force, password){
  return { type: MY_CHANNELS_CLOSE_CHANNEL, payload: { channelData, force, password } };
}

export function myChannelsCloseChannelSuccess(response) {
  return { type: MY_CHANNELS_CLOSE_CHANNEL_SUCCESS, payload: { response } };
}

export function myChannelsCloseChannelFail(error) {
  return { type: MY_CHANNELS_CLOSE_CHANNEL_FAIL, payload: { error } };
}

export  function  myChannelsShowAuthorizeModal(show){
  return { type: MY_CHANNELS_SHOW_AUTHORIZE_MODAL, payload: { show } };
}

export  function  myChannelChangeIndex(index){
  return { type: MY_CHANNELS_CHANGE_INDEX, payload: { index } };
}

export  function  myChannelResetChannelData(){
  return { type: MY_CHANNELS_RESET_CHANNEL_DATA };
}

export function syncChannelData(nodeName){
  return { type: MY_CHANNELS_RESET_CHANNEL_DATA, payload: { nodeName } };
}

export function syncChannelDataSuccess(response){
  return { type: MY_CHANNELS_RESET_CHANNEL_DATA, payload: { response } };
}

export function syncChannelDataFail(error){
  return { type: MY_CHANNELS_RESET_CHANNEL_DATA, payload: { error } };
}