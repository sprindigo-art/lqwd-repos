import React from 'react';
import faker from 'faker';
import Balance from './Balance';

export default {
  title: 'LQwD Dashboard/Balance',
  component: Balance,
};

export const zeroBalance = () => {
  return (
    <div>
      <Balance currency="sats" sent={0} received={0} balance={0} />
    </div>
  );
};

export const existingBalance = () => {

  const history = [];

  for (let i = 0; i < 30; i++) {
    history.push(
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
      <Balance currency="sats" sent={1000000} received={2000000}
               balanceHistory={history} selectCurrencyFunc={selectCur} balance={4000000} allCurrencies={currencies}/>
    </div>
  );
};
