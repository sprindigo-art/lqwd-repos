import React from 'react';
import ConfirmSelfManagedModal from './ConfirmSelfManagedModal';

export default {
  title: 'Lqwd Node/Confirm Self-Managed Modal',
  component: ConfirmSelfManagedModal,
};


const handleConfirm= () => {
  console.log('confirm');
}
const goBack= () => {
  console.log('going to previous step');
}


export const primary = () => {
  return (
    <ConfirmSelfManagedModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
    />
  );
};
