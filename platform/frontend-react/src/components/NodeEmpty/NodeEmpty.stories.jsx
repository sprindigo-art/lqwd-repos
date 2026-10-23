import React from 'react';
import EmptyNode from './NodeEmpty';

export default {
  title: 'LQWD Dashboard/Empty Node',
  component: EmptyNode,
};

export const primary = () => {
  return (
    <div>
      <EmptyNode />
    </div>
  );
};
