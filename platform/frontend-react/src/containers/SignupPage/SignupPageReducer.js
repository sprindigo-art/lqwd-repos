/* eslint-disable */
import {
  SIGNUP_PAGE_CREATE_ACCOUNT,
  SIGNUP_PAGE_CREATE_ACCOUNT_FAIL,
  SIGNUP_PAGE_CREATE_ACCOUNT_SUCCESS,
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS,
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS_FAIL,
  SIGNUP_PAGE_GET_NUM_BETA_SPOTS_SUCCESS, SIGNUP_PAGE_LOGGED_IN,
  SIGNUP_PAGE_MFA_LOGIN,
  SIGNUP_PAGE_MFA_LOGIN_FAIL,
  SIGNUP_PAGE_MFA_LOGIN_SUCCESS
} from "./SignupPageConstant";
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
  user: null,
  error: false,
  errMsg: '',
  loading: false,
  pending: false,
  numberOfSpots: {
    data: null
  },
  mfaSecret: {},
  mfaCode: {},
  mfaStatus: false,
  showMfaModal: false
};

export default function signupPageReducer(state = initialState, action) {
  switch (action.type) {
    case SIGNUP_PAGE_GET_NUM_BETA_SPOTS:
      return {
        ...state,
        loading: true,
      };
    case SIGNUP_PAGE_GET_NUM_BETA_SPOTS_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        numberOfSpots: action.payload.response,
      };
    case SIGNUP_PAGE_GET_NUM_BETA_SPOTS_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        errMsg: action.payload.error,
      };
    case SIGNUP_PAGE_CREATE_ACCOUNT:
      return {
        ...state,
        loading: true,
        error: false,
        pending: false,
        mfaStatus: false,
      };
    case SIGNUP_PAGE_CREATE_ACCOUNT_SUCCESS:
      return {
        ...state,
        loading: true,
        error: false,
        pending: true,
        mfaStatus: true,
        response: action.payload.response
      };
    case SIGNUP_PAGE_CREATE_ACCOUNT_FAIL:
      return {
        ...state,
        loading: false,
        error: true,
        pending: false,
        mfaStatus: false,
        errMsg: action.payload.error
      };
    case SIGNUP_PAGE_MFA_LOGIN:
      return {
        ...state,
        loading: true,
        error: false,
        pending: true,
      };
    case SIGNUP_PAGE_MFA_LOGIN_SUCCESS:
      return {
        ...state,
        loading: false,
        error: false,
        pending: true,
        errmsg: '',
        user: action.payload.response,
      };
    case SIGNUP_PAGE_MFA_LOGIN_FAIL:
      console.log(action);
      return {
        ...state,
        loading: false,
        pending: false,
        error: true,
        mfaStatus: true,
        errmsg: JSON.parse(action.payload.error.error).error_description,
      };
    case SIGNUP_PAGE_LOGGED_IN:
      return {
        ...state,
        pending: false,
        loading: false,
        error: false,
      };
    case USER_LOGOUT:
      return initialState;
    default:
      return {
        ...state,
      };
  }
}
