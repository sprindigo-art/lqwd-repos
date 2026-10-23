import {
  SHOW_NODE_DETAILS_MODAL,
  HIDE_NODE_DETAILS_MODAL,
} from './NodeDetailsConstants';

export const showNodeDetailsModal = nodeName => ({
  type: SHOW_NODE_DETAILS_MODAL,
  payload: { nodeName },
});

export function hideNodeDetailsModal() {
  return { type: HIDE_NODE_DETAILS_MODAL };
}
