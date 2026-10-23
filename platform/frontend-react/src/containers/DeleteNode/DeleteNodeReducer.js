/* eslint-disable */
import produce from 'immer';
import {
    SHOW_DELETE_NODE_MODAL,
    HIDE_DELETE_NODE_MODAL
} from './DeleteNodeConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    showModal: false,
    nodeName: ''
};

const deleteNodeReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_DELETE_NODE_MODAL:
                draft.showModal = true;
                draft.nodeName = payload.nodeName;
                break;
            case HIDE_DELETE_NODE_MODAL:
                draft.showModal = false;
                draft.nodeName = '';
                break;
          case USER_LOGOUT:
            return initialState;
            default:
        }
        return draft;
    });

export default deleteNodeReducer;