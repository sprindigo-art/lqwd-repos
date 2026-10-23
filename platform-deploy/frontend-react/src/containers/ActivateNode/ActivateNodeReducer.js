/* eslint-disable */
import produce from 'immer';
import {
    SHOW_ACTIVATE_MODAL,
    HIDE_ACTIVATE_MODAL,
    GET_SEEDS_FOR_ACTIVATION,
    ACTIVATION_SEEDS_SUCCESS,
    ACTIVATION_SEEDS_ERROR,
    ACTIVATE_NODE_REQUEST,
    ACTIVATE_NODE_SUCCEEDED,
    ACTIVATE_NODE_FAILED,
    ACTIVATE_NODE_EXPIRED,
    ACTIVATE_NODE_EXPIRED_CONFIRM,

} from './ActivateNodeConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    node: null,
    response: null,
    seeds: [],
    confirmationSeedsIndexes: [],
    confirmationSeeds: [],
    loadingSeeds: false,
    isActivated: false,
    showModal: false,
    error: '',
    confirmExpired: false,
};

const activateReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_ACTIVATE_MODAL:
                draft.showModal = true;
                break;
            case HIDE_ACTIVATE_MODAL:
                draft.showModal = false;
                draft.loadingSeeds = false;
                break;
            case GET_SEEDS_FOR_ACTIVATION:
                draft.node = payload.node;
                draft.seeds = [];
                draft.confirmExpired = false;
                draft.loadingSeeds = true;
                break;
            case ACTIVATION_SEEDS_SUCCESS:
                draft.loadingSeeds = false;
                draft.response = payload.response;
                draft.seeds = payload.response.object.split(',');
                draft.confirmationSeedsIndexes = payload.response.confirmationSeedsIndexes;
                break;
            case ACTIVATION_SEEDS_ERROR:
                draft.showModal = false;
                draft.loadingSeeds = false;
                draft.error = payload.error;
                break;
            case ACTIVATE_NODE_EXPIRED:
                draft.loadingSeeds = false;
                draft.confirmExpired = true;
                break;
            case ACTIVATE_NODE_EXPIRED_CONFIRM:
                draft.showModal = false;
                draft.confirmExpired = false;
                break;
            case ACTIVATE_NODE_REQUEST:
                draft.confirmationSeedsIndexes = payload.confirmationSeedsIndexes;
                draft.confirmationSeeds = payload.confirmationSeeds;
                break;
            case ACTIVATE_NODE_SUCCEEDED:
                draft.isActivated = true;
                draft.showModal = false;
                break;
            case ACTIVATE_NODE_FAILED:
                draft.showModal = false;
                draft.error = payload.error;
                break;
            case USER_LOGOUT:
                return initialState;
            default:
        }
        return draft;
    });

export default activateReducer;