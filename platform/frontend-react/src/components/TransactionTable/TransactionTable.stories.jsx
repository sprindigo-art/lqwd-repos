import React from 'react';
import TransactionTable from './TransactionTable';
import { transactions } from '../Transaction/TransactionStorybookExample'

export default {
    title: 'Transactions/Transaction Table',
    component: TransactionTable,
};

let currency = {
    code: 'sats',
    name: 'Satoshis',
    rate: 1,
}

export const primary = () => {
    return (
        <div>
            <TransactionTable transactions={transactions} currency={currency} pageSize={3} currentPage={2} />
        </div>
    );
};
