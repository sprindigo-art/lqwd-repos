import React from 'react';
import DashboardNode from './DashboardNode';
import { nodes } from '../Node/NodeStorybookExample'
import { useArgs } from '@storybook/client-api';


export default {
  title: 'LQWD Dashboard/Dashboard Node',
  component: DashboardNode,
  argTypes: {
    status: {
      control: {
        type: "select",
        options:
          ["CREATING", "RUNNING", "DELETED", "NEED_RESTART", "RESTARTING", "IS_AWAITING_WALLET_UNLOCK", "IS_WAITING_USER_CONFIRMATION"]
      }
    },
  }
};


export const primary = () => {
  const [{ status }, updateArgs] = useArgs();
  let node = nodes.find(item => item.status === status);
  if (!node) {
    node = nodes[0];
    updateArgs({ status: node.status })
  }

  return (
    <div>
      <DashboardNode
        selectedNode={node}
        nodes={nodes}
        nodeBalance={node.nodeBalance}
      />
    </div>
  );
};

export const running = () => {
  return (
    <div>
      <DashboardNode
        selectedNode={nodes[0]}
        nodes={nodes}
        nodeBalance={nodes[0].nodeBalance}
      />
    </div>
  );
};

export const needsRestart = () => {
  return (
    <div>
      <DashboardNode
        selectedNode={{ ...nodes[0], status: 'NEED_RESTART' }}
        nodes={nodes}
        nodeBalance={nodes[0].nodeBalance}
      />
    </div>
  );
};

export const restarting = () => {
  return (
    <div>
      <DashboardNode
        selectedNode={{ ...nodes[0], status: 'RESTARTING' }}
        nodes={nodes}
        nodeBalance={nodes[0].nodeBalance}
      />
    </div>
  );
};
