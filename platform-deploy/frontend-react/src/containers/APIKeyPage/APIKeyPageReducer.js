/* eslint-disable */
import produce from 'immer';
import { USER_LOGOUT } from "../App/AppConstants";
export const SET_API_KEYS = 'LQWD/API_KEY/SET_API_KEYS';

export const initialState = {
    allAPIKeys: [],
};

const APIKeyPageReducer = (state = initialState, action) =>
    produce(state, draft => {
        const { type, payload } = action;
        switch (type) {
            case SET_API_KEYS:
                draft.allAPIKeys = payload.allAPIKeys;
                break;
            case USER_LOGOUT:
              return initialState;
            default:
        }
        return draft;
    });

export default APIKeyPageReducer;