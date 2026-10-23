import React from 'react';
import NodeDetailsModal from './NodeDetails';
import { nodes } from '../Node/NodeStorybookExample'
import { useArgs } from '@storybook/client-api';

export default {
  title: 'LQWD Node/Node Details',
  component: NodeDetailsModal,
  argTypes: {
    status: {
      control: {
        type: "select",
        options:
          // note that only some nodes can show node details, so no need for creating ui for all
          // ["CREATING", "RUNNING", "DELETED", "NEED_RESTART", "RESTARTING", "IS_AWAITING_WALLET_UNLOCK", "IS_WAITING_USER_CONFIRMATION"]
          ["CREATING", "RUNNING", "IS_WAITING_USER_CONFIRMATION"]
      }
    },
  }
};

export const primary = ({ ...args }) => {
  const [{ status }, updateArgs] = useArgs();
  let node = nodes.find(item => item.status === status);
  if (!node) {
    node = nodes[0];
    updateArgs({ status: node.status })
  }

  return (
    <NodeDetailsModal status={node.status} show={true} selectedNode={node} nodeBalance={node.nodeBalance} data={node.data} />
  );
};

export const running = () => {
  let index = 0;
  return (
    <NodeDetailsModal status={nodes[index].status} show={true} selectedNode={nodes[index]} nodeBalance={nodes[index].nodeBalance} data={nodes[index].data} />
  );
};

export const waitingforconfirm = () => {
  let index = 1;
  return (
    <NodeDetailsModal status={nodes[index].status} show={true} selectedNode={nodes[index]} nodeBalance={nodes[index].nodeBalance} data={nodes[index].data} />
  );
};

export const creating = () => {
  let index = 2;
  return (
    <NodeDetailsModal status={nodes[index].status} show={true} selectedNode={nodes[index]} nodeBalance={nodes[index].nodeBalance} data={nodes[index].data} />
  );
};