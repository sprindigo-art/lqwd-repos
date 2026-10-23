/* eslint-disable */
import {
    LOGIN_SUCCEEDED,
    LOGGED_IN,
    TRY_LOGOUT,
    TRY_LOGIN_MFA,
    LOGIN_MFA_FAILED,
} from './LoginPageConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    user: null,
    error: false,
    errmsg: null,
    loading: false,
    pending: false,
    loginSuccess: false,
    response: {},
};

export default function userReducer(state = initialState, action) {
    switch (action.type) {
        case TRY_LOGIN_MFA:
            return {
                ...state,
                loading: true,
                mfaError: false,
                error: false,
                pending: true,
            };
        case LOGIN_MFA_FAILED:
            return {
                ...state,
                loading: false,
                loginSuccess: false,
                error: true,
                errmsg: JSON.parse(action.payload.error.error).error_description,
            };
        case LOGIN_SUCCEEDED:
            return {
                ...state,
                loading: false,
                error: false,
                pending: true,
                errmsg: '',
                user: action.payload.user,
            };
        case LOGGED_IN:
            return {
                ...state,
                pending: false,
                loading: false,
                error: false,
            };
        case TRY_LOGOUT:
            return {
                ...state,
                pending: false,
                loading: false,
                error: false,
                errmsg: '',
                user: null,
            };
        case USER_LOGOUT:
            return initialState;
        default:
            return {
                ...state,
            };
    }
}