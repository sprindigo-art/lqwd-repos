import React from 'react';
import TransactionFeeRates from './TransactionFeeRates';

export default {
    title: 'Lqwd Channels/Transaction Fee Rates',
    component: TransactionFeeRates,
};

const sharedStyle = {
    height: '100vh',
}

export const primary = () => {
    return (
        <div style={sharedStyle}>
            <TransactionFeeRates

            />
        </div>

    );
};