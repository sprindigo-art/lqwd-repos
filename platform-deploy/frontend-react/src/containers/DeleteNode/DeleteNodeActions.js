import {
  SHOW_DELETE_NODE_MODAL,
  HIDE_DELETE_NODE_MODAL,
} from './DeleteNodeConstants';

export const showDeleteNodeModal = nodeName => ({
  type: SHOW_DELETE_NODE_MODAL,
  payload: { nodeName },
});

export function hideDeleteNodeModal() {
  return { type: HIDE_DELETE_NODE_MODAL };
}
