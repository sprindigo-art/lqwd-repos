/* eslint-disable */
import {
    VERIFY_PAGE_GET_EMAIL,
    VERIFY_PAGE_GET_EMAIL_FAIL,
    VERIFY_PAGE_GET_EMAIL_SUCCESS,
    VERIFY_PAGE_SEND,
    VERIFY_PAGE_SEND_FAIL,
    VERIFY_PAGE_SEND_SUCCESS
} from "./VerifyPageConstants";

export const initialState = {
    user: null,
    error: false,
    errmsg: null,
    loading: false,
    pending: false,
    response: {},
    userEmail: '',
    userVerified: null,
};

export default function verifyReducer(state = initialState, action) {
    switch (action.type) {
        case VERIFY_PAGE_GET_EMAIL:
            return {
                ...state,
                loading: true,
                error: false,
                errmsg: '',
                pending: true,
                userEmail: null,
                userVerified: null,
            };
        case VERIFY_PAGE_GET_EMAIL_SUCCESS:
            console.log(state);
            return {
                ...state,
                loading: true,
                error: false,
                errmsg: '',
                pending: true,
                response: action.payload.response,
                userEmail: JSON.parse(action.payload.response.object).email,
                userVerified: JSON.parse(action.payload.response.object).emailstatus
            };
        case VERIFY_PAGE_GET_EMAIL_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errmsg: action.payload.error,
                pending: false,
                userEmail: null,
            };
        case VERIFY_PAGE_SEND:
            return {
                ...state,
                loading: true,
                error: false,
                errmsg: '',
                pending: true
            };
        case VERIFY_PAGE_SEND_SUCCESS:
            return {
                ...state,
                loading: true,
                error: false,
                errmsg: '',
                pending: true,
                response: action.payload.response
            };
        case VERIFY_PAGE_SEND_FAIL:
            return {
                ...state,
                loading: false,
                error: true,
                errmsg: action.payload.error,
                pending: false
            };
        default:
            return {
                ...state,
            };
    }
}