import React from 'react';
import TransactionBalance from './TransactionBalance';
import faker from 'faker';
import { getDates } from '../../utils/utils'

export default {
    title: 'Transactions/Transaction Balance',
    component: TransactionBalance,
};


// export const primary = () => {
//     return (
//         <div>
//             <TransactionBalance />
//         </div>
//     );
// };

export const existingBalance = () => {
    const allDates = getDates();
    let timespan = ({ start: allDates.monthStart, end: allDates.monthEnd, type: 'month' });
    const history1 = [];
    const history2 = [];

    for (let i = 0; i < 30; i++) {
        history1.push(
            faker.datatype.number({
                min: 10000000,
                max: 50000000,
            })
        );
        history2.push(
            faker.datatype.number({
                min: 10000000,
                max: 50000000,
            })
        );
    }

    const selectCur = () => {

    }

    const currencies = {
        USD: {
            code: 'USD',
            name: 'United states dollar',
            rate: 0.000000001,
        },
        Sats: {
            code: 'sats',
            name: 'Satoshis',
            rate: 1,
        },
        BTC: {
            code: 'BTC',
            name: 'Bitcoin',
            rate: 0.00000001,
        },
    }
    return (
        <div>
            transaction balance
            <TransactionBalance currency={currencies.Sats} spent={1000000} received={2000000}
                transactionReceived={history1}
                transactionSpent={history2}
                timespan={timespan}
                selectCurrencyFunc={selectCur} balance={4000000} allCurrencies={currencies} />
        </div>
    );
};
