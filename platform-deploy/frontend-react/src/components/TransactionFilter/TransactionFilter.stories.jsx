import React from 'react';
import TransactionFilter from './TransactionFilter';

export default {
    title: 'Transactions/Transaction Filter',
    component: TransactionFilter,
};

let nodes = [
    {
        label: 'Node 1'
    },
    {
        label: 'Node 2'
    },
    {
        label: 'Node 3'
    },
    {
        label: 'Node 4'
    }
]

export const primary = () => {
    return (
        <div style={{ width: '350px', height: '100vh' }}>
            <TransactionFilter nodes={nodes} />
        </div>
    );
};
