import {
  SHOW_RESTART_NODE_MODAL,
  HIDE_RESTART_NODE_MODAL,
} from './RestartNodeConstants';

export const showRestartNodeModal = (nodeName, isNonCustodial, status) => ({
  type: SHOW_RESTART_NODE_MODAL,
  payload: { nodeName, isNonCustodial, status },
});

export function hideRestartNodeModal() {
  return { type: HIDE_RESTART_NODE_MODAL };
}
