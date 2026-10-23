/* eslint-disable */
import produce from 'immer';
import {CHANGE_CURRENCY, CHANGE_BALANCE, CHANGE_NODE} from './DashboardNodeConstants';

export const initialState = {
    selectedNode: "",
    status: "Running",
    channels:[],
    detail: {}
};

const nodeReducer = (state = initialState, action) =>
    produce(state, draft => {
        const {type, payload} = action;
        switch (type) {
            case CHANGE_NODE:
                draft.status = payload.status;
                draft.channels = payload.channels;
                draft.detail = payload.detail;
                break;
            default:
        }
        return draft;
    });

export default nodeReducer;
