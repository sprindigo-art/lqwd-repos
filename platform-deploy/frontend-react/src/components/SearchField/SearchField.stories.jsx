/* eslint-disable */
import React from 'react';
import SearchField from "./SearchField";
import { channels } from '../Channel/ChannelStorybookExample'

export default {
  title: 'LQWD Basic/ Search Field',
  component: SearchField,
};

export const main = () => {
  let resultList = [
    {
      channelId: 'ch0001'
    },
    {
      channelId: 'ch0002'
    }
  ];

  return (
    <div>
      <SearchField id={"example1"} name={"example1"} placeholder={"Search Channels"} resultList={channels}></SearchField>
    </div>
  )
}