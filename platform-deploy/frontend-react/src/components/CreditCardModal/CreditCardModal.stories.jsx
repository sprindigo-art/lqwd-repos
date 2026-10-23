import React from 'react';
import CreditCardPayNow from './CreditCardPayNow';

export default {
  title: 'LQwD Dashboard/Credit Card Pay Modal',
  component: CreditCardPayNow,
};

export const primary = () => {
  const prop = {
    channelId: '12345623423',
    title: "SOT corp: 1 time",
    remoteBalance: 0,
    localBalance: 500000,
    status: 'PENDING_OPEN_CHANNEL',
    type: 'PENDING_OPEN_CHANNEL',
    currency: "sats",
    statusColor: '#FBCE8B',
  }

  return (
    <div>
      <CreditCardPayNow show={true}
                        nodeName={"Example Alias"}
                        amount={"$5.38 USD"}/>
    </div>
  );
};

export const update = () => {
  const prop = {
    channelId: '12345623423',
    title: "SOT corp: 1 time",
    remoteBalance: 0,
    localBalance: 500000,
    status: 'PENDING_OPEN_CHANNEL',
    type: 'PENDING_OPEN_CHANNEL',
    currency: "sats",
    statusColor: '#FBCE8B',
  }

  return (
    <div>
      <CreditCardPayNow show={true}
                        nodeName={"Example Alias"}
                        update={true}/>
    </div>
  );
};