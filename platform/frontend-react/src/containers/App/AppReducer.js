import produce from 'immer';
import { CHANGE_THEME } from './AppConstants';

// The initial state of the App
export const initialState = {
  theme_name: 'light',
  unimportant_data: 'test',
};

/* eslint-disable default-case, no-param-reassign */
const appReducer = (state = initialState, action) =>
  produce(state, draft => {
    switch (action.type) {
      case CHANGE_THEME:
        draft.theme_name = action.theme_name;
        break;
    }
  });

export default appReducer;
