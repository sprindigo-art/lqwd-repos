/*eslint-disable*/
import React from 'react';
import ChannelTableItem from "./ChannelTableItem";
import ChannelTableRow from "./ChannelTableRow";
import ChannelTable from "./ChannelTable";
import { channelsInfo } from '../Channel/ChannelStorybookExample'
import ChannelTableRowMobile from "./ChannelTableRowMobile";
import ChannelTableMobile from "./ChannelTableMobile";

export default {
  title: 'Components/Channel Table',
  component: ChannelTableItem,
};

export const item = () => {

  return (
    <ChannelTableItem
      {...channelsInfo.data[0]}
    />
  );
};

export const row = () => {

  return (
    <ChannelTableRow channels={channelsInfo.data} />
  );
};

export const rowMobile = () => {

  return (
    <ChannelTableRowMobile channels={channelsInfo.data} />
  );
};

export const table = () => {


  return (
    <ChannelTable channels={channelsInfo} />
  );

};

export const tableMobile = () => {


  return (
    <ChannelTableMobile channels={channelsInfo} />
  );

};
