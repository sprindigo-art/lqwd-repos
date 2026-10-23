/*eslint-disable*/
import {
  MANAGE_API_GET_NODES,
  MANAGE_API_GET_NODES_FAILED,
  MANAGE_API_GET_NODES_SUCCESS,
  MANAGE_API_SEND_COMMAND,
  MANAGE_API_SEND_COMMAND_FAILED,
  MANAGE_API_SEND_COMMAND_SUCCESS
} from "./ManageApiConstants";

export function getManageApiNodes() {
  return { type: MANAGE_API_GET_NODES };
}

export function getManageApiNodesFailed(error) {
  return { type: MANAGE_API_GET_NODES_FAILED, payload: { error } };
}

export function getManageApiNodesSuccess(response) {
  return { type: MANAGE_API_GET_NODES_SUCCESS, payload: { response } };
}

export function sendManageApiCommand(lndNode, command) {
  return { type: MANAGE_API_SEND_COMMAND, payload: {lndNode, command}};
}

export function sendManageApiCommandFailed(error) {
  return { type: MANAGE_API_SEND_COMMAND_FAILED, payload: { error } };
}

export function sendManageApiCommandSuccess(response) {
  return { type: MANAGE_API_SEND_COMMAND_SUCCESS, payload: { response } };
}
