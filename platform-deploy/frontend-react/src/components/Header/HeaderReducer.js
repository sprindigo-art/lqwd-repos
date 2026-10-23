import produce from 'immer';
import { HEADER_PAGE_CHANGED } from './HeaderConstants';
import { USER_LOGOUT } from '../../containers/App/AppConstants';

export const initialState = {
  headerpage: 'Dashboard',
};

const navigationReducer = (state = initialState, action) =>
  produce(state, draft => {
    const { type, payload } = action;
    switch (type) {
      case HEADER_PAGE_CHANGED:
        draft.headerpage = payload.headerpage;
        break;
      case USER_LOGOUT:
        return initialState;
      default:
    }
    return draft;
  });

export default navigationReducer;
