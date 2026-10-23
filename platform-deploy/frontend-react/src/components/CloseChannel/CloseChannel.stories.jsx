/*eslint-disable*/
import React from 'react';
import CloseChannelModal from "./CloseChannel";
import { channels } from '../Channel/ChannelStorybookExample'

export default {
  title: 'Components/Close Channel Modal',
  component: CloseChannelModal,
};

export const active = () => {

  return (
    <div>
      <CloseChannelModal show={true} channel={channels[0]}></CloseChannelModal>
    </div>
  );
};

export const inactive = () => {

  return (
    <div>
      <CloseChannelModal show={true} channel={channels[1]}></CloseChannelModal>
    </div>
  );
};
