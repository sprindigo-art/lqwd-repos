/* eslint-disable */

import {
    WITHDRAW_ACTIVE_STEP, WITHDRAW_HIDE_AUTHORIZE_MODAL,
    WITHDRAW_RESET,
    WITHDRAW_SELECT_NODE, WITHDRAW_SEND_COINS_FAILED,
    WITHDRAW_SEND_COINS_SUCCESS, WITHDRAW_SHOW_AUTHORIZE_MODAL,
    WITHDRAW_UPDATE_INFO
} from "./WithdrawConstants";
import {
    SEND_PAYMENT_KEY_SEND_PAY,
    SEND_PAYMENT_KEY_SEND_PAY_FAILED,
    SEND_PAYMENT_KEY_SEND_PAY_SUCCESS
} from "../PayKeySend/PayKeySendConstants";
import { MY_CHANNELS_SHOW_AUTHORIZE_MODAL } from "../MyChannels/MyChannelsConstants";

export const initialState = {
    activeStep:0,
    error: false,
    errorMsg: null,
    loading: true,
    selectedNode: null,
    amount: "",
    destination: "",
    paymentResponse: null,
    showAuthorize: false

};


// Use the initialState as a default value
export default function withdrawReducer(state = initialState, action) {
    switch (action.type) {
        case WITHDRAW_SELECT_NODE:
            return {
                ...state,
                selectedNode: action.payload.node,
            };
        case WITHDRAW_UPDATE_INFO:
            return {
                ...state,
                amount: action.payload.amount == null ? state.amount : action.payload.amount,
                destination: action.payload.destination == null ? state.destination : action.payload.destination,
            };
        case WITHDRAW_ACTIVE_STEP:
            return {...state, activeStep: action.payload.index};
        case WITHDRAW_SEND_COINS_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                paymentResponse: action.payload.response,
                activeStep: state.activeStep + 1,
                showAuthorize: false
            };
        case WITHDRAW_SEND_COINS_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: (action.payload.error.error === undefined ? action.payload.error.message : action.payload.error.error),
                activeStep: state.activeStep + 1,
                showAuthorize: false
            };
        case SEND_PAYMENT_KEY_SEND_PAY:
            return {...state, loading: true};
        case WITHDRAW_RESET:
            return initialState
        case WITHDRAW_SHOW_AUTHORIZE_MODAL:
            return {...state, showAuthorize: true};
        case WITHDRAW_HIDE_AUTHORIZE_MODAL:
            return {...state, showAuthorize: false};
        default:
            return state;
    }
}
