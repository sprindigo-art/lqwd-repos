/*eslint-disable*/
import React from 'react';
import ChannelDetailsModal from "./ChannelDetails";
import { channels } from '../Channel/ChannelStorybookExample'

export default {
  title: 'Components/Channel Details Modal',
  component: ChannelDetailsModal,
};

export const primary = () => {


  const walletBalance = {
    confirmed_balance: "120324.00",
    unconfirmed_balance: "0",
    total_balance: "120324.00",
  }

  return (
    <div>
      <ChannelDetailsModal channel={channels[0]} show={true} walletBalance={walletBalance}></ChannelDetailsModal>
    </div>
  );
};
