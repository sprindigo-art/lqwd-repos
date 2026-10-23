import React from 'react';
import TransactionItem from './TransactionItem';
import TransactionRow from './TransactionRow';

export default {
  title: 'Components/Transaction',
  component: TransactionItem,
};

export const item = () => {
  return (
    <div style={{ width: '400px', height:'90vh', border: '1px solid lightgray' }}>
      <TransactionItem
        title="LAO Inc - 1 year term"
        type="Invoice"
        amt="353,876.00 sats"
        typeColor="#D7F0FF"
      />
    </div>
  );
};

export const row = () => {
  const transactions = [
    {
      amt: '353,876.00 sats',
      title: 'LAO Inc - 1 year term',
      type: 'Invoice',
    },
    {
      amt: '53,876.00 sats',
      title: '3FZbgi09cpjq1GjdwV',
      type: 'Withdraw',
    },
    {
      amt: '53,876.00 sats',
      title: '3FZbgi09cpjq1GjdwV3FZbgi09cpjq1GjdwV3FZbgi09cpjq1GjdwV3FZbgi09cpjq1GjdwV3FZbgi09cpjq1GjdwV3FZbgi09cpjq1GjdwV',
      type: 'Direct',
    },
  ];
  return (
    <div style={{ width: '400px', height:'90vh', border: '1px solid lightgray' }}>
      <TransactionRow
        transactions={transactions}
        date="May 20, 2022"
      />
    </div>
  );
};