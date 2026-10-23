import { SET_API_KEYS } from './APIKeyPageReducer';

export function setAPIKey(allAPIKeys) {
  return { type: SET_API_KEYS, payload: { allAPIKeys } };
}
