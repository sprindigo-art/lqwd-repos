import React from 'react';
import SubscriptionCancelModal from './SubscriptionCancelModal';

export default {
  title: 'Lqwd Subscription/Cancel Subscription Modal',
  component: SubscriptionCancelModal,
};

const handleConfirm = ({ password, passphrase }) => {
  console.log('confirm: password: ' + password);
  console.log('confirm: passphrase: ' + passphrase);
}
const goBack = () => {
  console.log('going to previous step');
}

const handleHide = () => {
  console.log('closing');
}


export const primary = () => {
  return (
    <SubscriptionCancelModal
      show={true}
      showConfirm={false}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={"example"}
      status={0}
    />
  );
};

export const secondary = () => {
  return (
    <SubscriptionCancelModal
      show={false}
      showConfirm={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
      handleHide={handleHide}
      node={"example"}
      status={0}
    />
  );
};