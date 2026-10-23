import React from 'react';
import CreateNodeModal from './CreateNodeModal';
import { Button } from 'react-bootstrap'

export default {
    title: 'Lqwd Node/Create Node Modal',
    component: CreateNodeModal,
    argTypes: {
        variant: {
            show: { type: 'radio' },
        },
    },
};

export const primary = ({ ...args }) => {
    return (
        <div>
            <CreateNodeModal
                show={args.show}
            />

        </div>
    );
};
primary.args = {
    show: false,
  };
