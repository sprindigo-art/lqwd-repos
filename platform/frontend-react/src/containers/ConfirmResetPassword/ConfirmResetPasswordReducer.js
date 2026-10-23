/*eslint-disable*/
import {
  CONFIRM_PASS,
  CONFIRM_PASS_FAIL,
  CONFIRM_PASS_SUCCESS,
} from './ConfirmResetPasswordConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
  response: null,
  error: false,
  errMsg: '',
  loading: false,
  pending: false,
  success: false,
};

export default function confirmResetPasswordReducer(
  state = initialState,
  action
) {
  switch (action.type) {
    case CONFIRM_PASS:
      return {
        ...state,
        loading: true,
        pending: true,
      };
    case CONFIRM_PASS_SUCCESS:
      return {
        ...state,
        loading: false,
        pending: false,
        error: false,
        response: JSON.parse(action.payload.response.object),
        success: true,
      };
    case CONFIRM_PASS_FAIL:
      return {
        ...state,
        loading: false,
        pending: false,
        error: true,
        errMsg: JSON.parse(action.payload.error).error,
      };
    case USER_LOGOUT:
      return initialState;
    default:
      return {
        ...state,
      };
  }
}
