import { CHANGE_NODE } from './DashboardNodeConstants';

export function changeNode({ nodeStatus, nodeDetail, nodeChannels }) {
  return {
    type: CHANGE_NODE,
    payload: { detail: nodeDetail, channels: nodeChannels, status: nodeStatus },
  };
}
