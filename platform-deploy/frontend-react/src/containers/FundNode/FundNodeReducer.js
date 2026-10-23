/* eslint-disable */
import produce from 'immer';
import {
    CREATE_DEPOSIT_ADDRESS,
    CREATE_DEPOSIT_ADDRESS_FAILED,
    CREATE_DEPOSIT_ADDRESS_SUCCESS,
    HIDE_FUND_NODE_MODAL,
    SHOW_FUND_NODE_MODAL
} from "./FundNodeConstants";
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    nodeName: "",
    response: null,
    showModal: false,
    error: null,
    loadingAddress: false
};

const fundNodeReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_FUND_NODE_MODAL:
                draft.showModal = true;
                draft.nodeName = payload.nodeName
                break;
            case HIDE_FUND_NODE_MODAL:
                draft.showModal = false;
                draft.loadingAddress = false;
                break;
            case CREATE_DEPOSIT_ADDRESS:
                draft.loadingAddress = true;
                break;
            case CREATE_DEPOSIT_ADDRESS_SUCCESS:
                draft.response = payload.response;
                draft.loadingAddress = false;
                break;
            case CREATE_DEPOSIT_ADDRESS_FAILED:
                draft.error = payload.error;
                draft.loadingAddress = false;
                draft.showModal = false;
                break;
            case USER_LOGOUT:
                return initialState;
            default:
        }
        return draft;
    });

export default fundNodeReducer;