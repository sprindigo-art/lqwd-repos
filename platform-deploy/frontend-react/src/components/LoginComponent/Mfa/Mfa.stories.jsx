import React from 'react';
import Mfa from './Mfa';
import { useArgs } from '@storybook/client-api';

export default {
  title: 'LQWD Login/MFA',
  component: Mfa,
  args: {
    isOpen: false,
  }
};



export const primary = ({...args}) => {

  const [{ isOpen }, updateArgs] = useArgs();

  const onCancel = () => {
    // console.log('onCancel');
    updateArgs({ isOpen: !isOpen })
  }

  const onActivate = (result, cb) => {
    // console.log('onActivate: data ' + result);
    if (result == '123456'){
      updateArgs({ isOpen: !isOpen })
      cb(null);
    }else{
      cb(true);
    }
  }

  return (
    <div>
      {/*<button onClick={() => updateArgs({ isOpen: !isOpen })}> show </button>*/}
      <div> for 123456, it should pass, otherwise should show error </div>
      <Mfa
        show={isOpen}
        onCancel={onCancel}
        onActivate={onActivate}
        secret="Z6UCDN323GTWSJU"
        mfaUrl="Z6UCDN323GTWSJU"
      />

    </div>
  );
};


