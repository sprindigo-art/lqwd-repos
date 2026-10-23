import produce from 'immer';
import {
  GET_CHANNEL_DETAILS,
  CHANNEL_DETAILS_SUCCESS,
  CHANNEL_DETAILS_ERROR,
} from './ChannelDetailsConstants';
import { USER_LOGOUT } from '../../containers/App/AppConstants';

export const initialState = {
  channelData: 0,
  error: false,
  errorMsg: '',
  loading: true,
};

const channelDetailsReducer = (state = initialState, action) =>
  produce(state, draft => {
    const { type, payload } = action;
    switch (type) {
      case GET_CHANNEL_DETAILS:
        draft.loading = true;
        draft.error = false;
        draft.errorMsg = '';
        break;
      case CHANNEL_DETAILS_SUCCESS:
        draft.loading = false;
        draft.channelData = payload.channelData;
        break;
      case CHANNEL_DETAILS_ERROR:
        draft.loading = false;
        draft.error = true;
        draft.errorMsg = payload.errorMsg;
        break;
      case USER_LOGOUT:
        return initialState;
      default:
    }
    return draft;
  });

export default channelDetailsReducer;
