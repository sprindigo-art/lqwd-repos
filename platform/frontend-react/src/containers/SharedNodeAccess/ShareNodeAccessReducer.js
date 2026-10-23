/*eslint-disable*/
import {
  SHARE_NODE_ADD_USER,
  SHARE_NODE_ADD_USER_FAIL,
  SHARE_NODE_ADD_USER_SUCCESS,
  SHARE_NODE_DEACTIVATE_SHARE,
  SHARE_NODE_DEACTIVATE_SHARE_FAIL,
  SHARE_NODE_DEACTIVATE_SHARE_SUCCESS,
  SHARE_NODE_GET_NODE_LIST,
  SHARE_NODE_GET_NODE_LIST_FAIL,
  SHARE_NODE_GET_NODE_LIST_SUCCESS,
  SHARE_NODE_GET_SHARE_INFO,
  SHARE_NODE_GET_SHARE_INFO_FAIL,
  SHARE_NODE_GET_SHARE_INFO_SUCCESS,
  SHARE_NODE_GET_USER_LIST,
  SHARE_NODE_GET_USER_LIST_FAIL,
  SHARE_NODE_GET_USER_LIST_SUCCESS,
  SHARE_NODE_RESET_USER_INFO,
  SHARE_NODE_SET_USER_INFO,
  SHARE_NODE_UPDATE_STATUS,
  SHARE_NODE_UPDATE_STATUS_FAIL,
  SHARE_NODE_UPDATE_STATUS_SUCCESS
} from "./ShareNodeAccessContants";
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
  error: false,
  errorMsg: null,
  loading: false,
  response: {},
  sharedUserList: [],
  sharedNodeList: [],
  addUserInfo: {}
};

// Use the initialState as a default value
export default function shareNodeAccessReducer(state = initialState, action) {
  switch (action.type) {
    case SHARE_NODE_SET_USER_INFO:
      return {
        ...state,
        addUserInfo: action.payload
      };
    case SHARE_NODE_RESET_USER_INFO:
      return {
        ...state,
        addUserInfo: {}
      };
    case SHARE_NODE_GET_SHARE_INFO:
      return {
        ...state,
      };
    case SHARE_NODE_GET_SHARE_INFO_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        response: action.payload.response,
      };
    case SHARE_NODE_GET_SHARE_INFO_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case SHARE_NODE_ADD_USER:
      return {
        ...state,
      };
    case SHARE_NODE_ADD_USER_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        response: action.payload.response,
      };
    case SHARE_NODE_ADD_USER_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case SHARE_NODE_UPDATE_STATUS:
      return {
        ...state,
      };
    case SHARE_NODE_UPDATE_STATUS_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        response: action.payload.response,
      };
    case SHARE_NODE_UPDATE_STATUS_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case SHARE_NODE_DEACTIVATE_SHARE:
      return {
        ...state,
      };
    case SHARE_NODE_DEACTIVATE_SHARE_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        response: action.payload.response,
      };
    case SHARE_NODE_DEACTIVATE_SHARE_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case SHARE_NODE_GET_NODE_LIST:
      return {
        ...state,
      };
    case SHARE_NODE_GET_NODE_LIST_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        sharedNodeList: JSON.parse(action.payload.response.object),
      };
    case SHARE_NODE_GET_NODE_LIST_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case SHARE_NODE_GET_USER_LIST:
      return {
        ...state,
      };
    case SHARE_NODE_GET_USER_LIST_SUCCESS:
      return {
        ...state,
        error: false,
        errorMsg: {},
        sharedUserList: JSON.parse(action.payload.response.object),
      };
    case SHARE_NODE_GET_USER_LIST_FAIL:
      return {
        ...state,
        error: true,
        errorMsg: action.payload.error,
        response: {}
      };
    case USER_LOGOUT:
      return initialState;
    default:
      return state;
  }
}