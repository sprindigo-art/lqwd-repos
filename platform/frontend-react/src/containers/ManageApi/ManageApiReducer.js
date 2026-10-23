/* eslint-disable */
import {
  MANAGE_API_GET_NODES,
  MANAGE_API_GET_NODES_FAILED,
  MANAGE_API_GET_NODES_SUCCESS, MANAGE_API_SEND_COMMAND, MANAGE_API_SEND_COMMAND_FAILED, MANAGE_API_SEND_COMMAND_SUCCESS
} from "./ManageApiConstants";
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
  error: false,
  errMsg: null,
  loading: false,
  pending: false,
  response: {},
  nodes: null,
  commandOutput: {},
};

export default function manageApiReducer(state = initialState, action) {
  switch (action.type) {
    case MANAGE_API_GET_NODES:
      return {
        ...state,
        loading: true,
        error: false,
        pending: true,
      };
    case MANAGE_API_GET_NODES_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        pending: false,
        nodes: JSON.parse(action.payload.response.object),
        response: action.payload.response
      };
    case MANAGE_API_GET_NODES_FAILED:
      return {
        ...state,
        loading: false,
        error: true,
        pending: false,
        errMsg: action.payload.error,
        nodes: null
      };
    case MANAGE_API_SEND_COMMAND:
      return {
        ...state,
        loading: true,
        error: false,
        pending: true,
      };
    case MANAGE_API_SEND_COMMAND_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        pending: false,
        commandOutput: action.payload.response
      };
    case MANAGE_API_SEND_COMMAND_FAILED:
      return {
        ...state,
        loading: false,
        error: true,
        pending: false,
        errMsg: action.payload.error,
        nodes: null,
        commandOutput: {}
      };
    case USER_LOGOUT:
      return initialState;
    default:
      return {
        ...state,
      };
  }
}