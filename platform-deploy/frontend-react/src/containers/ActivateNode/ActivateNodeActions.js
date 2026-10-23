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

export function showActivateModal() {
  return { type: SHOW_ACTIVATE_MODAL };
}

export function hideActivateModal() {
  return { type: HIDE_ACTIVATE_MODAL };
}

export const getSeeds = node => ({
  type: GET_SEEDS_FOR_ACTIVATION,
  payload: { node },
});

export function getSeedsSucceeded(node, response) {
  return { type: ACTIVATION_SEEDS_SUCCESS, payload: { node, response } };
}

export function getSeedsFailed(error) {
  return { type: ACTIVATION_SEEDS_ERROR, payload: { error } };
}

export const tryConfirmSeed = payload => ({
  type: ACTIVATE_NODE_REQUEST,
  payload,
});

export function confirmSeedsSucceeded(node, response) {
  return { type: ACTIVATE_NODE_SUCCEEDED, payload: { node, response } };
}

export function confirmSeedsFailed(error) {
  return { type: ACTIVATE_NODE_FAILED, payload: { error } };
}

export function ActivateModalExpired() {
  return { type: ACTIVATE_NODE_EXPIRED, payload: {} };
}

export function ActivateModalConfirmExpired() {
  return { type: ACTIVATE_NODE_EXPIRED_CONFIRM, payload: {} };
}
