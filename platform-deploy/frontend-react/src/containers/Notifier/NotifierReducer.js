import {
  ENQUEUE_SNACKBAR,
  CLOSE_SNACKBAR,
  REMOVE_SNACKBAR,
} from './NotifierActions';
import { USER_LOGOUT } from '../App/AppConstants';
import { initialState } from '../../managers/nodeManager/nodeReducer';

const defaultState = {
  notifications: [],
};

export default (state = defaultState, action) => {
  switch (action.type) {
    case ENQUEUE_SNACKBAR:
      return {
        ...state,
        notifications: [
          ...state.notifications,
          {
            key: action.key,
            ...action.notification,
          },
        ],
      };

    case CLOSE_SNACKBAR:
      return {
        ...state,
        notifications: state.notifications.map(notification => {
          return action.dismissAll || notification.key === action.key
            ? { ...notification, dismissed: true }
            : { ...notification };
        }),
      };

    case REMOVE_SNACKBAR:
      return {
        ...state,
        notifications: state.notifications.filter(
          notification => notification.key !== action.key
        ),
      };
    case USER_LOGOUT:
      return defaultState;
    default:
      return state;
  }
};
