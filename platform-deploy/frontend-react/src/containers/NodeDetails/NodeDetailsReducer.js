/* eslint-disable */
import produce from 'immer';
import {
    SHOW_NODE_DETAILS_MODAL,
    HIDE_NODE_DETAILS_MODAL,
} from './NodeDetailsConstants';

export const initialState = {
    showModal: false,
    nodeName: ''
};

const nodeDetailsReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_NODE_DETAILS_MODAL:
                draft.showModal = true;
                draft.nodeName = payload.nodeName;
                break;
            case HIDE_NODE_DETAILS_MODAL:
                draft.showModal = false;
                draft.nodeName = '';
                break;
            default:
        }
        return draft;
    });

export default nodeDetailsReducer;