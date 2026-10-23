import { GET_CHANNEL_DETAILS, CHANNEL_DETAILS_SUCCESS, CHANNEL_DETAILS_ERROR } from './ChannelDetailsConstants';

export function getChannelInfo(channel) {
  return { type: GET_CHANNEL_DETAILS, payload: {channel} };
}

export function channelInfoSuccess(channelData) {
  return { type: CHANNEL_DETAILS_SUCCESS , payload: {channelData}};
}

export function channelInfoError(errorMsg) {
  return { type: CHANNEL_DETAILS_SUCCESS, payload: {errorMsg} };
}

