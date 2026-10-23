/* eslint-disable */
import {
    SEND_PAYMENT_KEY_SEND_ACTIVE_STEP,
    SEND_PAYMENT_KEY_SEND_PAY,
    SEND_PAYMENT_KEY_SEND_PAY_FAILED,
    SEND_PAYMENT_KEY_SEND_PAY_SUCCESS,
    SEND_PAYMENT_KEY_SEND_SELECT_NODE,
    SEND_PAYMENT_KEY_SEND_UPDATE_INFO
} from "./PayKeySendConstants";

export const initialState = {
    activeStep:0,
    error: false,
    errorMsg: null,
    loading: true,
    selectedNode: null,
    showStep: false,
    amount: "",
    destination: "",
    paymentResponse: null

};


// Use the initialState as a default value
export default function payKeySendReducer(state = initialState, action) {
    switch (action.type) {
        case SEND_PAYMENT_KEY_SEND_UPDATE_INFO:
            return {
                ...state,
                amount: action.payload.amount == null ? state.amount : action.payload.amount,
                destination: action.payload.destination == null ? state.destination : action.payload.destination,
            };
        case SEND_PAYMENT_KEY_SEND_SELECT_NODE:
            return {
                ...state,
                selectedNode: action.payload.node,
            };
        case SEND_PAYMENT_KEY_SEND_PAY_SUCCESS:
            return {
                ...state,
                loading: false,
                error: false,
                paymentResponse: action.payload.response,
                activeStep: state.activeStep + 1
            };
        case SEND_PAYMENT_KEY_SEND_PAY_FAILED:
            return {
                ...state,
                loading: false,
                error: true,
                errorMsg: action.payload.error,
                activeStep: state.activeStep + 1
            };
        case SEND_PAYMENT_KEY_SEND_PAY:
            return {...state, loading: true};
        case SEND_PAYMENT_KEY_SEND_ACTIVE_STEP:
            return {...state, activeStep: action.payload.index};
        default:
            return state;
    }
}
