/* eslint-disable */
import produce from 'immer';
import {
    CONNECTED_TO_SERVER,
    DISCONNECTED_FROM_SERVER,
} from './ServerConnectionBannerConstants';

export const initialState = {
    connected: true,
};

const ServerConnectionBannerReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case CONNECTED_TO_SERVER:
                draft.connected = true;
                break;
            case DISCONNECTED_FROM_SERVER:
                draft.connected = false;
                break;
            default:
        }
        return draft;
    });

export default ServerConnectionBannerReducer;