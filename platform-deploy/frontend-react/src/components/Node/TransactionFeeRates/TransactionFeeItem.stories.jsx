import React from 'react';
import TransactionFeeItem from './TransactionFeeItem';

export default {
    title: 'Lqwd Channels/Transaction Fee Item',
    component: TransactionFeeItem,
};

const sharedStyle = {
    width: '308px'
}

export const highPriority = () => {
    return (
        <div style={sharedStyle}>
            <TransactionFeeItem
                priority='high'
                rate={1}
            />

        </div>
    );
};

export const mediumPriority = () => {
    return (
        <div style={sharedStyle}>
            <TransactionFeeItem
                priority='medium'
                rate={1}
            />
        </div>
    );
};

export const lowPriority = () => {
    return (
        <div style={sharedStyle}>
            <TransactionFeeItem
                priority='low'
                rate={1}
            />
        </div>
    );
};