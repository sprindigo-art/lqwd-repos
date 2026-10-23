import {
  REQUEST_ACCOUNTING_GET_API_KEY_HISTORY,
  REQUEST_ACCOUNTING_GET_API_KEY_HISTORY_FAIL,
  REQUEST_ACCOUNTING_GET_API_KEY_HISTORY_SUCCESS,
  REQUEST_ACCOUNTING_GET_API_KEYS,
  REQUEST_ACCOUNTING_GET_API_KEYS_FAIL,
  REQUEST_ACCOUNTING_GET_API_KEYS_SUCCESS,
} from './RequestAccountingConstants';
import { USER_LOGOUT } from '../App/AppConstants';

export const initialState = {
  error: false,
  errorMsg: null,
  loading: false,
  apiKeys: [],
  response: {},
  totalPages: 1,
};

// Use the initialState as a default value
export default function requestAccountingReducer(state = initialState, action) {
  switch (action.type) {
    case REQUEST_ACCOUNTING_GET_API_KEYS:
      return {
        ...state,
        loading: true,
      };
    case REQUEST_ACCOUNTING_GET_API_KEYS_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        apiKeys: JSON.parse(JSON.parse(action.payload.response.object).apikey),
      };
    case REQUEST_ACCOUNTING_GET_API_KEYS_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case REQUEST_ACCOUNTING_GET_API_KEY_HISTORY:
      return {
        ...state,
        loading: true,
      };
    case REQUEST_ACCOUNTING_GET_API_KEY_HISTORY_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        response: action.payload.response,
      };
    case REQUEST_ACCOUNTING_GET_API_KEY_HISTORY_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errorMsg: action.payload.error,
      };
    case USER_LOGOUT:
      return initialState;
    default:
      return state;
  }
}
