import {
  CONNECTED_TO_SERVER,
  DISCONNECTED_FROM_SERVER,
} from './ServerConnectionBannerConstants';

export function serverConnectionStatusChanged(state) {
  if (state) {
    return { type: CONNECTED_TO_SERVER };
  }
  return { type: DISCONNECTED_FROM_SERVER };
}
