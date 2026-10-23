/* eslint-disable */
import produce from 'immer';
import {
    SHOW_RESTART_NODE_MODAL,
    HIDE_RESTART_NODE_MODAL
} from './RestartNodeConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    showModal: false,
    nodeName: '',
    isNonCustodial: false,
    status: '',
};

const restartNodeReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_RESTART_NODE_MODAL:
                draft.showModal = true;
                draft.nodeName = payload.nodeName;
                draft.isNonCustodial = payload.isNonCustodial;
                draft.status = payload.status;
                break;
            case HIDE_RESTART_NODE_MODAL:
                draft.showModal = false;
                draft.nodeName = '';
                draft.isNonCustodial = false;
                draft.status = '';
                break;
            case USER_LOGOUT:
                return initialState;
            default:
        }
        return draft;
    });

export default restartNodeReducer;