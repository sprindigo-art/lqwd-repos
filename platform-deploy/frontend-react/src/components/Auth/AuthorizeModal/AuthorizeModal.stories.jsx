import React from 'react';
import AuthorizeModal from './AuthorizeModal';

export default {
  title: 'Lqwd Basic/Authorize Modal',
  component: AuthorizeModal,
};


const handleConfirm= (val) => {
  console.log(val);
}
const goBack= () => {
  console.log('going to previous step');
}


export const primary = () => {
  return (
    <AuthorizeModal
      show={true}
      handleConfirm={handleConfirm}
      goBack={goBack}
    />
  );
};


export const error = () => {
  return (
    <AuthorizeModal
      show={true}
      handleConfirm={handleConfirm}
      error={true}
      goBack={goBack}
    />
  );
};
