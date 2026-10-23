import {
  GET_NODE_DETAIL,
  GET_NODE_DETAIL_FAILED,
  GET_NODE_DETAIL_SUCCESS,
  GET_NODE_LIST,
  GET_NODE_LIST_FAILED,
  GET_NODE_LIST_SUCCESS,
  REMOVE_NODE,
  // selected Node
  CHANGE_SELECTED_NODE,
  GET_SHARED_NODE_LIST,
  GET_SHARED_NODE_LIST_FAIL,
  GET_SHARED_NODE_LIST_SUCCESS,
  GET_SHARED_NODE_DETAIL,
  GET_SHARED_NODE_DETAIL_SUCCESS,
  GET_SHARED_NODE_DETAIL_FAILED,
} from './nodeConstants';

export function getNodeList() {
  return { type: GET_NODE_LIST };
}

export function getNodeListFailed(error) {
  return { type: GET_NODE_LIST_FAILED, payload: { error } };
}

export function getNodeListSuccess(response) {
  return { type: GET_NODE_LIST_SUCCESS, payload: { response } };
}

export function getNodeDetail(nodeName) {
  return { type: GET_NODE_DETAIL, payload: { nodeName } };
}

export function getNodeDetailFailed(error) {
  return { type: GET_NODE_DETAIL_FAILED, payload: { error } };
}

export function getNodeDetailSuccess(nodeName, response) {
  return { type: GET_NODE_DETAIL_SUCCESS, payload: { nodeName, response } };
}

export function removeNode(nodeName) {
  return { type: REMOVE_NODE, payload: { nodeName } };
}

// selected Node
export function changeSelectedNode(nodeName) {
  return { type: CHANGE_SELECTED_NODE, payload: { nodeName } };
}

export function getSharedNodeList() {
  return { type: GET_SHARED_NODE_LIST };
}

export function getSharedNodeListFailed(error) {
  return { type: GET_SHARED_NODE_LIST_FAIL, payload: { error } };
}

export function getSharedNodeListSuccess(response) {
  return { type: GET_SHARED_NODE_LIST_SUCCESS, payload: { response } };
}

export function getSharedNodeDetail(nodeName) {
  return { type: GET_SHARED_NODE_DETAIL, payload: { nodeName } };
}

export function getSharedNodeDetailFailed(error) {
  return { type: GET_SHARED_NODE_DETAIL_FAILED, payload: { error } };
}

export function getSharedNodeDetailSuccess(nodeName, response) {
  return {
    type: GET_SHARED_NODE_DETAIL_SUCCESS,
    payload: { nodeName, response },
  };
}
