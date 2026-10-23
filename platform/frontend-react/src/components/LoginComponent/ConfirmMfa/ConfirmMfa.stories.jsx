import React from 'react';
import ConfirmMfa from './ConfirmMfa';

export default {
  title: 'Lqwd Login/Confirm MFA',
  component: ConfirmMfa,
};


export const primary = () => {
  const onActivate = (result) => {
    console.log('onActivate: data ' + result);
  }

  return (
    <div style={{width: '400px', border: '1px solid lightgray'}}>
      <ConfirmMfa
        onActivate={onActivate}
        error={false}
      />

    </div>
  );
};

export const error = () => {

  const onActivate = (result) => {
    console.log('onActivate: data ' + result);
  }

  return (
    <div style={{width: '400px', border: '1px solid lightgray'}}>
      <ConfirmMfa
        onActivate={onActivate}
        error={true}
      />

    </div>
  );
};

export const activateMode = () => {

  const onActivate = (result) => {
    console.log('onActivate: data ' + result);
  }

  return (
    <div style={{width: '400px', border: '1px solid lightgray'}}>
      <ConfirmMfa
        onActivate={onActivate}
        activateMode={true}
      />

    </div>
  );
};