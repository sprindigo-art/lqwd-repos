/* eslint-disable */
import produce from 'immer';
import {
    SHOW_CREATE_NODE_MODAL,
    HIDE_CREATE_NODE_MODAL,
    SET_NODE_INFO,
    SET_PLAN,
    CREATE_NODE_REQUEST,
    CREATE_NODE_SUCCEEDED,
    CREATE_NODE_FAILED,
    CREATE_NODE_ALERT,
    CREATE_NODE_ALERT_ACK,
    SET_ACTIVE_STEP,
    SET_PAYMENT_AND_CREATE_NODE,
    SET_PAYMENT_AND_CREATE_NODE_SUCCESS,
    SET_PAYMENT_AND_CREATE_NODE_ERROR,
    SET_SHOW_HINT,
} from './CreateNodeConstants';
import { USER_LOGOUT } from "../App/AppConstants";

export const initialState = {
    payload: {},
    response: null,
    showModal: false,
    error: '',
    loading: false,
    alert: false,
    info: {},
    plan: '',
    paymentMethod: 0,
    activeStep: 1,
    amount: 0,
    address: '',
    blocking: false,
    dontShowHintAgain: false,
    payment: {}
};

const createNodeReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SHOW_CREATE_NODE_MODAL:
                draft.showModal = true;
                draft.activeStep = 1;
                draft.plan = '';
                draft.blocking = false;
                break;
            case HIDE_CREATE_NODE_MODAL:
                draft.showModal = false;
                break;
            case SET_NODE_INFO:
                draft.info = payload.info;
                draft.activeStep = payload.step || state.activeStep;
                break;
            case SET_SHOW_HINT:
                draft.dontShowHintAgain = payload.dontShowHintAgain || state.dontShowHintAgain;
                break;
            case SET_PLAN:
                draft.plan = payload.plan;
                draft.activeStep = payload.step || state.activeStep;
                break;
            case SET_PAYMENT_AND_CREATE_NODE:
                draft.paymentMethod = payload.paymentMethod;
                draft.payment = {};
                draft.blocking = true;
                break;
            case SET_PAYMENT_AND_CREATE_NODE_SUCCESS:
                draft.activeStep = 4;
                draft.address = payload.object != null ? JSON.parse(payload.object).paymentMedium : {};
                draft.payment = payload.object != null ? JSON.parse(payload.object) : {};
                draft.blocking = false;
                break;
            case SET_PAYMENT_AND_CREATE_NODE_ERROR:
                draft.blocking = false;
                draft.payment = {};
                break;
            case SET_ACTIVE_STEP:
                draft.activeStep = payload;
                break;
            case CREATE_NODE_REQUEST:
                draft.payload = payload;
                draft.error = '';
                draft.loading = true;
            case CREATE_NODE_SUCCEEDED:
                draft.loading = false;
                draft.showModal = false;
                draft.response = payload.response;
                draft.info = {}
                draft.plan = ''
            case CREATE_NODE_FAILED:
                draft.loading = false;
                draft.error = payload.error.message;
            case CREATE_NODE_ALERT:
                draft.alert = true;
            case CREATE_NODE_ALERT_ACK:
                draft.alert = false;
            case USER_LOGOUT:
                return initialState;
            default:
        }
        return draft;
    });

export default createNodeReducer;