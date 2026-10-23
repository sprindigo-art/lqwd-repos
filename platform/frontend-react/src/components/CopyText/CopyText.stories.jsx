import React from 'react';
import CopyText from './CopyText';

export default {
    title: 'Components/CopyText',
    component: CopyText,
};

export const shortText = () => {
    const text = "I am short"

    return (
        <div>
      <CopyText text={text} />
        </div>
    );
};

export const longText = () => {
    const text = "036e09ad698a96913f330156eb82b51ffcfd3e0978c591c203bdfd884cc659dcd1@tlnd-32515.lqwd-lnd:32515"

  return (
    <div>
      <CopyText text={text} />
    </div>
    );
};
