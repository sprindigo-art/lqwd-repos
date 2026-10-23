/* eslint-disable */
import React from 'react';
import {nodes} from '../Node/NodeStorybookExample'
import {address} from "./NodeFundModalExamples";
import NodeFundModal from './NodeFundModal';

export default {
    title: 'LQWD Node/Node Fund Modal',
    component: NodeFundModal,
};

export const nodeFunding = () => {
    let index = 0;
    return (
        <NodeFundModal status={nodes[index].status}  show={true} selectedNode={nodes[index]} data={address}/>
    );
};