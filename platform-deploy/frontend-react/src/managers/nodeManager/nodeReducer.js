import produce from 'immer';
import {
  GET_NODE_DETAIL,
  GET_NODE_DETAIL_FAILED,
  GET_NODE_DETAIL_SUCCESS,
  GET_NODE_LIST,
  GET_NODE_LIST_FAILED,
  GET_NODE_LIST_SUCCESS,
  CHANGE_SELECTED_NODE,
  REMOVE_NODE,
  GET_SHARED_NODE_LIST,
  GET_SHARED_NODE_LIST_FAIL,
  GET_SHARED_NODE_LIST_SUCCESS,
  GET_SHARED_NODE_DETAIL,
  GET_SHARED_NODE_DETAIL_FAILED,
  GET_SHARED_NODE_DETAIL_SUCCESS,
} from './nodeConstants';
import { USER_LOGOUT } from '../../containers/App/AppConstants';

export const initialState = {
  loading: true,
  error: false,
  errorMsg: '',
  nodeList: [],
  sharedNodeList: [],
  nodeInfos: new Map(),
  sharedNodeInfos: new Map(),
};

const nodeReducer = (state = initialState, action) =>
  produce(state, draft => {
    const { type, payload } = action;
    switch (type) {
      //= ===========  Node List ============//
      case GET_NODE_LIST:
        draft.loading = true;
        draft.nodeInfos = new Map();
        break;
      case GET_NODE_LIST_FAILED:
        draft.loading = false;
        draft.error = true;
        draft.errorMsg = action.payload.error;
        break;
      case GET_NODE_LIST_SUCCESS:
        draft.loading = false;
        draft.error = false;
        draft.nodeList = JSON.parse(action.payload.response.object);
        break;

      //= =========== Node Details ============//
      case GET_NODE_DETAIL:
        break;
      case GET_NODE_DETAIL_FAILED:
        break;
      case GET_NODE_DETAIL_SUCCESS:
        draft.nodeInfos.set(
          action.payload.nodeName,
          action.payload.response.data
        );
        break;
      case REMOVE_NODE:
        draft.nodeList = state.nodeList.filter(
          e => e.lndNodeName !== action.payload.nodeName
        );
        break;

      //= =========== Shared Node List ============//
      case GET_SHARED_NODE_LIST:
        draft.loading = true;
        draft.sharedNodeInfos = new Map();
        break;
      case GET_SHARED_NODE_LIST_FAIL:
        draft.loading = false;
        draft.error = true;
        draft.errorMsg = action.payload.error;
        break;
      case GET_SHARED_NODE_LIST_SUCCESS:
        draft.loading = false;
        draft.error = false;
        draft.sharedNodeList = JSON.parse(payload.response.object);
        break;

      //= =========== Shared Node Details ============//
      case GET_SHARED_NODE_DETAIL:
        break;
      case GET_SHARED_NODE_DETAIL_FAILED:
        break;
      case GET_SHARED_NODE_DETAIL_SUCCESS:
        draft.sharedNodeInfos.set(
          action.payload.nodeName,
          action.payload.response.data
        );
        break;
      case USER_LOGOUT:
        return initialState;
      default:
    }
    return draft;
  });

const selectedNodeInitial = {
  nodeName: '',
};
export const selectedNodeReducer = (state = selectedNodeInitial, action) =>
  produce(state, draft => {
    const { type, payload } = action;
    switch (type) {
      case CHANGE_SELECTED_NODE:
        draft.nodeName = action.payload.nodeName;
        break;
      case USER_LOGOUT:
        return selectedNodeInitial;
      default:
    }
    return draft;
  });

export default nodeReducer;
