/* eslint-disable */
import produce from 'immer';
import {
    SHOW_TRANSACTION_DETAILS_MODAL,
    HIDE_TRANSACTION_DETAILS_MODAL,
} from './TransactionDetailsConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    showModal: false,
    transaction: null,
};

const transactionDetailsReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_TRANSACTION_DETAILS_MODAL:
                draft.showModal = true;
                draft.transaction = payload.transaction;
                break;
            case HIDE_TRANSACTION_DETAILS_MODAL:
                draft.showModal = false;
                draft.transaction = null;
                break;
          case USER_LOGOUT:
            return initialState;
          default:
        }
        return draft;
    });

export default transactionDetailsReducer;